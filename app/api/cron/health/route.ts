import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { checkInstagramHealth, HEALTH_TEXT } from "@/lib/health"
import { sendAlert } from "@/lib/notify"
import { minutesSincePublishRun } from "@/lib/publishing"

// Frequent health check (GitHub Actions every 30 min; Vercel's free cron is daily only).
// Protected by CRON_SECRET, like the daily job. Sends an alert when access is down.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = await getSupabaseServerClient()

  // ?test=1 sends a test notification to confirm the alert channel works.
  if (request.nextUrl.searchParams.get("test") === "1") {
    const sent = await sendAlert(db, `test:${Date.now()}`, "teste de alerta", "Se você recebeu isto, os alertas estão funcionando. ✅")
    return NextResponse.json({ ok: true, test: sent ? "enviado" : "nenhum canal configurado (NTFY_TOPIC / RESEND_API_KEY)" })
  }

  const { data: users } = await db.from("users").select("id, username, access_token")
  const results = []
  for (const user of users || []) {
    const health = await checkInstagramHealth(user.access_token)
    if (!health.ok && health.reason) {
      const text = HEALTH_TEXT[health.reason]
      const sent = await sendAlert(db, `health:${user.id}:${health.reason}`, text.title, `@${user.username}: ${text.action}\n\nDetalhe da Meta: ${health.message || health.reason}`)
      console.warn(`[health] @${user.username} down: ${health.reason} (${health.code}) alert=${sent}`)
    }
    results.push({ username: user.username, ok: health.ok, reason: health.reason || null })
  }

  // The publishing queue must run every 5 min (Supabase pg_cron); warn if it stopped while posts are waiting.
  const stalled = await minutesSincePublishRun(db)
  if (stalled === null || stalled > 30) {
    const { count } = await db.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending")
    if (count) await sendAlert(db, "scheduler-stalled", "agenda de posts parada", `${count} posts na fila e o agendador não roda há ${stalled ?? "?"} min. Confira o pg_cron no Supabase (migrations/008_agendador_pg_cron.sql).`)
  }
  return NextResponse.json({ ok: true, results })
}
