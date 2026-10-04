import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export const maxDuration = 60

const BATCH = 1000
const MAX_ROWS = 200_000

// Tables included in the backup and the column that ties each one to the account.
// The users table is left out on purpose: it holds the Instagram token.
const TABLES: Array<[table: string, owner: string]> = [
  ["automations", "user_id"],
  ["ice_breakers", "user_id"],
  ["contacts", "user_id"],
  ["contact_events", "user_id"],
  ["conversations", "user_id"],
  ["messages", "user_id"],
  ["files", "user_id"],
  ["tracked_links", "user_id"],
]

// GET /api/admin/backup?userId= — downloads every record of the account as JSON (owner session only).
// Uploaded files themselves stay in Supabase Storage; only their list is included.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data: account } = await db.from("users").select("id, username, business_account_id, created_at").eq("id", userId).single()
  if (!account) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  const tables: Record<string, unknown[]> = {}
  for (const [table, owner] of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; from < MAX_ROWS; from += BATCH) {
      const { data, error } = await db.from(table).select("*").eq(owner, userId).range(from, from + BATCH - 1)
      if (error) {
        console.error(`[backup] ${table}:`, error.message)
        break
      }
      rows.push(...(data || []))
      if (!data || data.length < BATCH) break
    }
    tables[table] = rows
  }

  const backup = {
    format: "cee-automacao-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    account,
    counts: Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length])),
    tables,
  }
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="backup-cee-automacao-${date}.json"`,
      "Cache-Control": "no-store",
    },
  })
}
