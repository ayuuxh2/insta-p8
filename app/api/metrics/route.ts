import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { PRIVATE_REPLY_HOURLY_LIMIT } from "@/lib/antispam"

const MAX_EVENTS = 100_000
const BATCH = 1000
const TZ = "America/Sao_Paulo"

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) // YYYY-MM-DD

// GET /api/metrics?userId=&days=7|30|90 — funnel, per-rule numbers and daily series.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const days = [7, 30, 90].includes(Number(request.nextUrl.searchParams.get("days"))) ? Number(request.nextUrl.searchParams.get("days")) : 30
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const since = new Date(Date.now() - days * 86_400_000)
  since.setHours(0, 0, 0, 0)

  const events: Array<{ event: string; ig_id: string; automation_id: string | null; created_at: string }> = []
  for (let from = 0; from < MAX_EVENTS; from += BATCH) {
    const { data, error } = await db
      .from("contact_events")
      .select("event, ig_id, automation_id, created_at")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + BATCH - 1)
    if (error) return NextResponse.json({ error: "Não foi possível carregar as métricas" }, { status: 500 })
    events.push(...(data || []))
    if (!data || data.length < BATCH) break
  }

  const [{ data: rules }, newContacts, optedOut, privateLastHour] = await Promise.all([
    db.from("automations").select("id, name, trigger_source, is_active").eq("user_id", userId),
    db.from("contacts").select("ig_id", { count: "exact", head: true }).eq("user_id", userId).gte("first_seen_at", since.toISOString()),
    db.from("contacts").select("ig_id", { count: "exact", head: true }).eq("user_id", userId).eq("opted_out", true),
    db.from("send_log").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "private_reply").gte("created_at", new Date(Date.now() - 3_600_000).toISOString()),
  ])

  // Totals and distinct people per event.
  const totals: Record<string, number> = {}
  const people: Record<string, Set<string>> = {}
  for (const e of events) {
    totals[e.event] = (totals[e.event] || 0) + 1
    ;(people[e.event] ||= new Set()).add(e.ig_id)
  }
  const distinct = (event: string) => people[event]?.size || 0

  // People asked to follow who later received the content = converted by the follow gate.
  const gated = people.gate_sent || new Set<string>()
  const delivered = people.content_sent || new Set<string>()
  const gateConverted = [...gated].filter((id) => delivered.has(id)).length

  // Per rule.
  const perRule = new Map<string, { triggers: number; taps: number; delivered: number; clicks: number; gates: number }>()
  for (const e of events) {
    if (!e.automation_id) continue
    const row = perRule.get(e.automation_id) || { triggers: 0, taps: 0, delivered: 0, clicks: 0, gates: 0 }
    if (e.event === "comment" || e.event === "dm" || e.event === "story") row.triggers++
    else if (e.event === "optin_tap") row.taps++
    else if (e.event === "content_sent") row.delivered++
    else if (e.event === "link_click") row.clicks++
    else if (e.event === "gate_sent") row.gates++
    perRule.set(e.automation_id, row)
  }
  const ruleNames = new Map((rules || []).map((r: any) => [r.id, r]))
  const byRule = [...perRule.entries()]
    .map(([id, row]) => ({ id, name: (ruleNames.get(id) as any)?.name || "Regra excluída", source: (ruleNames.get(id) as any)?.trigger_source || null, ...row }))
    .sort((a, b) => b.triggers - a.triggers)

  // Daily series (every day of the period, zero-filled).
  const series: Record<string, { day: string; triggers: number; delivered: number; clicks: number }> = {}
  for (let d = new Date(since); d <= new Date(); d = new Date(d.getTime() + 86_400_000)) {
    const key = dayKey(d.toISOString())
    series[key] = { day: key, triggers: 0, delivered: 0, clicks: 0 }
  }
  for (const e of events) {
    const row = series[dayKey(e.created_at)]
    if (!row) continue
    if (e.event === "comment" || e.event === "dm" || e.event === "story") row.triggers++
    else if (e.event === "content_sent") row.delivered++
    else if (e.event === "link_click") row.clicks++
  }

  return NextResponse.json({
    days,
    totals: {
      comments: totals.comment || 0,
      dms: totals.dm || 0,
      stories: totals.story || 0,
      optinSent: totals.optin_sent || 0,
      optinTaps: totals.optin_tap || 0,
      delivered: totals.content_sent || 0,
      clicks: totals.link_click || 0,
      gateSent: distinct("gate_sent"),
      gateConverted,
      newContacts: newContacts.count || 0,
      optOuts: totals.opt_out || 0,
      optedOutTotal: optedOut.count || 0,
      peopleReached: distinct("content_sent"),
      peopleClicked: distinct("link_click"),
    },
    limit: { privateRepliesLastHour: privateLastHour.count || 0, max: PRIVATE_REPLY_HOURLY_LIMIT },
    byRule,
    daily: Object.values(series),
  })
}
