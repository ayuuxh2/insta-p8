import * as fs from "fs"
import * as path from "path"
import { getSupabaseAdmin } from "./supabase-admin"

let _migrated = false
let _running: Promise<void> | null = null

/**
 * Run schema.sql's safe DDL against the live database. Idempotent.
 *
 * Auto-migration scope (lib/supabase-migrate.ts handles on every cold start):
 *   - CREATE TABLE IF NOT EXISTS
 *   - CREATE [UNIQUE] INDEX IF NOT EXISTS
 *   - CREATE EXTENSION IF NOT EXISTS
 *   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
 *   - CREATE OR REPLACE FUNCTION (plpgsql RPCs, including $$ ... $$ bodies)
 *
 * Manual one-time setup (apply via Supabase SQL editor -- anon role required):
 *   - CREATE POLICY (RLS)
 *   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY
 */
const EXPECTED_TABLES = [
  "users",
  "conversations",
  "messages",
  "webhook_events",
  "automations",
  "media_cache",
  "ice_breakers",
  "content_pool",
  "scheduler_config",
  "reels_posts",
  "dm_queue",
  "unlock_attempts",
]

export async function ensureSchema(): Promise<void> {
  if (_migrated) return
  if (_running) return _running

  _running = (async () => {
    const schemaPath = path.join(process.cwd(), "schema.sql")
    if (!fs.existsSync(schemaPath)) {
      console.warn(`[migrate] schema.sql not found at ${schemaPath}, skipping auto-migration`)
      return
    }

    console.log(`[migrate] Applying schema.sql (idempotent CREATE TABLE / INDEX / EXTENSION / FUNCTION)...`)

    const sql = fs.readFileSync(schemaPath, "utf8")
    const supabase = getSupabaseAdmin()
    const statements = parseSafeStatements(sql)
    console.log(`[migrate] Extracted ${statements.length} safe statements...`)

    for (const stmt of statements) {
      try {
        const { error } = await supabase.rpc("exec_sql", { sql: stmt })
        if (error) {
          console.warn(`[migrate] exec_sql RPC skipped (${error.message})`)
          console.warn(`[migrate] Run schema.sql in the Supabase SQL editor if tables/RPCs are missing.`)
          break
        }
      } catch (e) {
        console.warn(`[migrate] exec_sql RPC unavailable:`, e instanceof Error ? e.message : e)
        console.warn(`[migrate] Run schema.sql in the Supabase SQL editor if tables/RPCs are missing.`)
        break
      }
    }

    _migrated = true
  })()

  return _running
}

/**
 * Extract CREATE TABLE / CREATE INDEX / CREATE EXTENSION / ALTER TABLE ... ADD
 * COLUMN / CREATE OR REPLACE FUNCTION statements from schema.sql.
 * Each accepted form must be idempotent (IF NOT EXISTS / OR REPLACE).
 * We deliberately EXCLUDE CREATE POLICY
 * -- policies require one-time application in the SQL editor because they
 * reference the `anon` role and the table-level ALTER TABLE ... ENABLE ROW
 * LEVEL SECURITY.
 *
 * For CREATE OR REPLACE FUNCTION bodies, we collect lines until the closing
 * `$$;` marker (Postgres dollar-quoted function bodies).
 *
 * Each statement is fetched in declaration order. The IF NOT EXISTS / OR REPLACE
 * guards make every statement safe to re-run.
 */
function parseSafeStatements(sql: string): string[] {
  const out: string[] = []
  const lines = sql.split("\n")
  let buf: string[] = []
  let inStatement = false
  // Inside a CREATE OR REPLACE FUNCTION body, lines may end with `;` and
  // we'd terminate too early. We wait until the closing `$$;` (dollar-quoted
  // body terminator) before flushing.
  let inDollarBody = false

  for (const line of lines) {
    const trimmed = line.trim()
    const starts =
      /^(CREATE\s+(TABLE|INDEX|EXTENSION)\s+IF\s+NOT\s+EXISTS|CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS|ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS|CREATE\s+OR\s+REPLACE\s+FUNCTION)/i.test(
        trimmed,
      )

    if (!inStatement && starts) {
      inStatement = true
      buf = [line]
      // Did THIS line open a $$ body? CREATE OR REPLACE FUNCTION bodies are
      // opened by the `AS $$` line, which is usually a few lines after the
      // declaration -- not the declaration line itself.
      if (/\$\$/.test(trimmed)) {
        inDollarBody = true
      }
      // CREATE OR REPLACE FUNCTION always spans multiple lines, so a `;`
      // here would be a single-line CREATE TABLE -- flush it.
      if (!inDollarBody && trimmed.endsWith(";")) {
        out.push(buf.join("\n"))
        buf = []
        inStatement = false
      }
      continue
    }

    if (inStatement) {
      buf.push(line)
      // Did THIS line open the $$ body? (CREATE OR REPLACE FUNCTION declarations
      // are followed by `AS $$` on a separate line.)
      if (!inDollarBody && /\$\$/.test(trimmed)) {
        inDollarBody = true
      }
      // Function body terminates when we see `$$;` on its own line.
      if (inDollarBody && trimmed === "$$;") {
        out.push(buf.join("\n"))
        buf = []
        inStatement = false
        inDollarBody = false
      } else if (!inDollarBody && trimmed.endsWith(";")) {
        // Non-function statements end with `;` on the last line.
        out.push(buf.join("\n"))
        buf = []
        inStatement = false
      }
    }
  }
  return out
}
