import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// GET /api/webhook-log?userId= — last received comments/messages and what the bot did.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("webhook_events")
    .select("id, event_type, data, processed_at")
    .eq("user_id", userId)
    .order("processed_at", { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: "Não foi possível carregar o registro" }, { status: 500 })
  return NextResponse.json({ events: data || [] })
}
