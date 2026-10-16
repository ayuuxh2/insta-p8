import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId obrigatório" }, { status: 400 })

  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase
    .from("users")
    .select("groq_auto_reply_enabled, ai_context, groq_api_key, ai_base_url, ai_model")
    .eq("id", userId)
    .single()

  if (error || !data) return NextResponse.json({ enabled: false, ai_context: "", has_api_key: false, ai_base_url: "", ai_model: "" })
  return NextResponse.json({
    enabled: data.groq_auto_reply_enabled ?? false,
    ai_context: data.ai_context ?? "",
    has_api_key: Boolean(data.groq_api_key),
    ai_base_url: data.ai_base_url ?? "",
    ai_model: data.ai_model ?? "",
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const { userId, enabled, ai_context, groq_api_key, ai_base_url, ai_model } = body
  if (!userId) return NextResponse.json({ error: "userId obrigatório" }, { status: 400 })

  const supabase = await getSupabaseServerClient()
  const update: Record<string, unknown> = {}
  if (typeof enabled === "boolean") update.groq_auto_reply_enabled = enabled
  if (typeof ai_context === "string") update.ai_context = ai_context
  if (typeof groq_api_key === "string") update.groq_api_key = groq_api_key || null
  if (typeof ai_base_url === "string") update.ai_base_url = ai_base_url || null
  if (typeof ai_model === "string") update.ai_model = ai_model || null

  const { error } = await supabase.from("users").update(update).eq("id", userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
