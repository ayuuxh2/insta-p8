import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { checkInstagramHealth, HEALTH_TEXT } from "@/lib/health"
import { sendAlert } from "@/lib/notify"
import { minutesSincePublishRun } from "@/lib/publishing"

// Daily job (vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
// - Refreshes long-lived Instagram tokens before they expire (they last ~60 days).
// - Purges stale unlock attempts.
// Touching the database daily also keeps the free Supabase project from pausing.

const REFRESH_WHEN_DAYS_LEFT = 30

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: users, error } = await supabase
    .from("users")
    .select("id, username, access_token, token_expires_at")
    .not("access_token", "is", null)
  if (error) {
    console.error("[cron] Failed to load users:", error.message)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }

  // ?force=1 refreshes now regardless of the expiry date (to verify the mechanism).
  const force = request.nextUrl.searchParams.get("force") === "1"
  const results: Array<{ username: string; status: string }> = []
  for (const user of users || []) {
    const expiresAt = user.token_expires_at ? new Date(user.token_expires_at).getTime() : 0
    const daysLeft = (expiresAt - Date.now()) / 86_400_000
    if (daysLeft > REFRESH_WHEN_DAYS_LEFT && !force) {
      results.push({ username: user.username, status: `ok (${Math.floor(daysLeft)} dias restantes)` })
      continue
    }

    try {
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(user.access_token)}`,
        { cache: "no-store" },
      )
      const data = await res.json()
      if (!res.ok || !data.access_token) {
        console.error(`[cron] Token refresh failed for @${user.username}:`, data.error?.code, data.error?.message)
        results.push({ username: user.username, status: `falhou (${data.error?.code ?? res.status})` })
        continue
      }
      await supabase
        .from("users")
        .update({
          access_token: data.access_token,
          token_expires_at: new Date(Date.now() + (data.expires_in || 5_184_000) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
      results.push({ username: user.username, status: "renovado" })
    } catch (e: any) {
      console.error(`[cron] Token refresh request failed for @${user.username}:`, e?.message)
      results.push({ username: user.username, status: "erro de rede" })
    }
  }

  const { error: purgeError } = await supabase
    .from("unlock_attempts")
    .delete()
    .lt("updated_at", new Date(Date.now() - 86_400_000).toISOString())
  if (purgeError) console.error("[cron] unlock_attempts purge failed:", purgeError.message)

  // Anti-spam bookkeeping: Meta retries within hours, the hourly limit needs one hour.
  const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
  // Retention (also stated in the privacy policy): event log 14 days, links 180 days, history 12 months.
  const purges: Array<[string, string, string]> = [
    ["processed_events", "created_at", days(30)],
    ["send_log", "created_at", days(7)],
    ["webhook_events", "processed_at", days(14)],
    ["tracked_links", "created_at", days(180)],
    ["contact_events", "created_at", days(365)],
  ]
  for (const [table, column, olderThan] of purges) {
    const { error: e } = await supabase.from(table).delete().lt(column, olderThan)
    if (e) console.error(`[cron] ${table} purge failed:`, e.message)
  }

  // Fallback health check (the GitHub Actions check every 30 min is the main one).
  for (const user of users || []) {
    const health = await checkInstagramHealth(user.access_token)
    if (!health.ok && health.reason) {
      const text = HEALTH_TEXT[health.reason]
      await sendAlert(supabase, `health:${user.id}:${health.reason}`, text.title, `@${user.username}: ${text.action}\n\nDetalhe da Meta: ${health.message || health.reason}`)
    }
  }


  // The publishing queue must run every 5 min (Supabase pg_cron); warn if it stopped while posts are waiting.
  const stalled = await minutesSincePublishRun(supabase)
  if (stalled === null || stalled > 30) {
    const { count } = await supabase.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending")
    if (count) await sendAlert(supabase, "scheduler-stalled", "agenda de posts parada", `${count} posts na fila e o agendador não roda há ${stalled ?? "?"} min. Confira o pg_cron no Supabase (migrations/008_agendador_pg_cron.sql).`)
  }
  console.log("[cron] daily:", JSON.stringify(results))
  return NextResponse.json({ ok: true, results })
}
