import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { checkInstagramHealth, HEALTH_TEXT } from "@/lib/health"
import { minutesSincePublishRun } from "@/lib/publishing"

// GET /api/agent/status — connection health, publishing permission and remaining daily posts.
export async function GET(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ ok: false, error: "Nenhuma conta do Instagram conectada" })

  const health = await checkInstagramHealth(user.access_token)
  let publishing: { used?: number; limit?: number; error?: string } = {}
  try {
    const res = await fetch("https://graph.instagram.com/v24.0/me/content_publishing_limit?fields=quota_usage,config", {
      headers: { Authorization: `Bearer ${user.access_token}` },
      cache: "no-store",
    })
    const json = await res.json()
    if (json.error) publishing.error = json.error.message
    else publishing = { used: json.data?.[0]?.quota_usage ?? 0, limit: json.data?.[0]?.config?.quota_total ?? 100 }
  } catch (e: any) {
    publishing.error = e?.message
  }

  return NextResponse.json({
    ok: health.ok,
    username: user.username,
    connection: health.ok ? "ok" : HEALTH_TEXT[health.reason!].title,
    publishing,
    // Minutes since the scheduled queue last ran (pg_cron every 5 min); null = never ran.
    scheduler: { minutesSinceLastRun: await minutesSincePublishRun(db) },
  })
}
