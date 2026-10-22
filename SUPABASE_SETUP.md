# Supabase Setup

This document covers the **one-time manual steps** required to set up the Supabase
backend for InstaAuto. The runtime migration runner (`lib/supabase-migrate.ts`)
auto-creates tables on every cold start, but a few things still need to be applied
by hand because the migration runner cannot switch into the `anon` role.

## TL;DR

```txt
1. Create a Supabase project
2. Run schema.sql in the SQL editor                  ← what this document covers
3. Enable pg_cron for the cleanup job
4. Copy URL + anon key + service role key into .env.local
```

---

## 1. Run the schema

**Why hand-applied?** `schema.sql` includes `CREATE POLICY` and `ALTER TABLE
... ENABLE ROW LEVEL SECURITY` statements. These reference the `anon` role,
which the migration runner does not switch into. Run it once in the SQL editor
and you're done — every statement is `IF NOT EXISTS` so re-running is safe.

**Steps:**

1. Open https://supabase.com/dashboard and choose your project
2. Left sidebar → **SQL editor**
3. Click **New query**
4. Paste the entire contents of `schema.sql` from the project root
5. Click **Run** (or `Ctrl+Enter`)

The script creates 12 tables, indexes, the `reels` storage bucket, the
per-user RLS policies, and the `bump_unlock_attempt` RPC.

---

## 2. Schedule the unlock-attempt cleanup

The follower-gate cap writes per-user-per-rule attempt counts to
`public.unlock_attempts`. Most cleanup happens implicitly (the `ON CONFLICT
DO UPDATE` clause in the RPC and the read-path eviction both refresh stale
entries), but a small footprint grows over time. The cheapest way to keep it
bounded is pg_cron.

**Steps:**

1. Supabase dashboard → **Database** → **Extensions**
2. Search for `pg_cron`, click **Enable**
3. Back to **SQL editor**, run once:

```sql
SELECT cron.schedule('purge-unlock-attempts', '0 * * * *',
  $$DELETE FROM public.unlock_attempts WHERE updated_at < NOW() - INTERVAL '24 hours'$$);
```

This deletes rows older than 24 hours, every hour. The 24h window matches
Instagram's private-reply quota, so we're never throwing away state that an
active user could still need.

**Manual purge** (e.g. for debugging):

```sql
DELETE FROM public.unlock_attempts WHERE updated_at < NOW() - INTERVAL '24 hours';
```

---

## 3. Verify the install

Run these in the SQL editor to confirm the schema is in place:

```sql
-- Should return 12
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';

-- Should return 'bump_unlock_attempt'
SELECT proname FROM pg_proc WHERE proname = 'bump_unlock_attempt';

-- Should return 12 RLS policy rows
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';

-- Should show 12 tables with RLS enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

If any of these returns 0, re-run `schema.sql` from step 1.

---

## 4. Environment variables

Put these in `.env.local` (development) or your Vercel project settings
(production):

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...           # safe to expose / anon key
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-only; bypasses RLS
```

> ⚠️  Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client. The server-side
> API routes use it to bypass RLS for cross-user operations like the webhook
> handler reading the automation list. The anon-key path is enforced only on
> tables that have user-scoped policies.

---

## 5. How the migration runner works

`lib/supabase-migrate.ts` is called from the webhook handler on every cold
start:

```ts
ensureSchema().catch((e) => console.warn("[webhook] ensureSchema failed:", e?.message))
```

It opens the bundled `schema.sql`, extracts only `CREATE TABLE / INDEX /
EXTENSION` statements (deliberately skipping `CREATE POLICY` and `ALTER
TABLE ... ENABLE ROW LEVEL SECURITY`), and runs them through the RPC
`exec_sql(sql text)` if the project has it set up. If not, it logs a clear
warning and falls back to the SQL-editor path.

The end-state requirement is the same: schema.sql must be applied once at
deploy time. The runner is a safety net for fresh environments that didn't
get the manual step.

---

## 6. If something breaks

| Symptom | Check |
|---|---|
| Anon key reads return zero rows | RLS policies weren't applied. Re-run `schema.sql`. |
| `bump_unlock_attempt` does not exist | The RPC wasn't created. Search the SQL editor for `CREATE OR REPLACE FUNCTION` and re-run that block. |
| Webhook logs "schema.sql not found" | `schema.sql` isn't in the Vercel bundle. Confirm `outputFileTracingIncludes` in `next.config.mjs` includes `./schema.sql`. |
| `pg_cron` says "extension not found" | The extension wasn't enabled. Database → Extensions → pg_cron → Enable. |
| Webhook logs "ensureSchema failed: exec_sql RPC skipped" | Expected on a fresh project — the SQL editor path is the canonical setup. Run `schema.sql` manually. |
