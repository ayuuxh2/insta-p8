import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { checkInstagramHealth, HEALTH_TEXT } from "@/lib/health"

// Checks whether the stored token still works, so the dashboard can warn the owner.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data: user } = await db.from("users").select("access_token, token_expires_at").eq("id", userId).single()

  const health = await checkInstagramHealth(user?.access_token)
  return NextResponse.json({
    ok: health.ok,
    reason: health.reason,
    code: health.code,
    title: health.reason ? HEALTH_TEXT[health.reason].title : null,
    action: health.reason ? HEALTH_TEXT[health.reason].action : null,
    expiresAt: user?.token_expires_at,
  })
}
