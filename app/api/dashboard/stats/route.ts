import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// GET /api/dashboard/stats?userId= — home screen numbers (last 30 days) and recent activity.
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

    const db = await getSupabaseServerClient()
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const events = (event: string) =>
      db.from("contact_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("event", event).gte("created_at", since)

    const results = await Promise.all([
      db.from("automations").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true),
      db.from("contacts").select("ig_id", { count: "exact", head: true }).eq("user_id", userId),
      events("content_sent"),
      events("link_click"),
      db
        .from("contact_events")
        .select("id, event, ig_id, created_at, automations(name)")
        .eq("user_id", userId)
        .in("event", ["comment", "dm", "story", "optin_tap", "content_sent", "link_click", "opt_out"])
        .order("created_at", { ascending: false })
        .limit(8),
    ])
    const failed = results.find((r: any) => r.error)
    if (failed?.error) throw failed.error
    const [active, contacts, delivered, clicks, recent] = results as any[]

    const ids = [...new Set((recent.data || []).map((e: any) => e.ig_id))]
    const { data: people } = ids.length
      ? await db.from("contacts").select("ig_id, username").eq("user_id", userId).in("ig_id", ids)
      : { data: [] as any[] }
    const usernames = new Map((people || []).map((p: any) => [p.ig_id, p.username]))

    return NextResponse.json({
      metrics: {
        activeTriggers: active.count || 0,
        contacts: contacts.count || 0,
        delivered30d: delivered.count || 0,
        clicks30d: clicks.count || 0,
      },
      recentActivity: (recent.data || []).map((e: any) => ({
        id: e.id,
        event: e.event,
        created_at: e.created_at,
        username: usernames.get(e.ig_id) || null,
        rule: e.automations?.name || null,
      })),
    })
  } catch (error) {
    console.error("[dashboard] stats error:", error)
    return NextResponse.json({ error: "Não foi possível carregar as estatísticas" }, { status: 500 })
  }
}
