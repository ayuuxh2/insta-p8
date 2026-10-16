import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// GET /api/contacts/events?userId=&igId= — latest interactions of one contact, with rule names.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const igId = request.nextUrl.searchParams.get("igId")
  if (!userId || !igId) return NextResponse.json({ error: "Dados ausentes" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("contact_events")
    .select("event, keyword, created_at, automations(name)")
    .eq("user_id", userId)
    .eq("ig_id", igId)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico" }, { status: 500 })

  return NextResponse.json({
    events: (data || []).map((e: any) => ({
      event: e.event,
      keyword: e.keyword,
      created_at: e.created_at,
      rule: e.automations?.name || null,
    })),
  })
}
