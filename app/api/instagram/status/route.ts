import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// Checks whether the stored Instagram token still works, so the dashboard can ask for a reconnect.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const supabase = await getSupabaseServerClient()
  const { data: user } = await supabase
    .from("users")
    .select("access_token, token_expires_at")
    .eq("id", userId)
    .single()

  if (!user?.access_token) return NextResponse.json({ ok: false, reason: "not_connected" })

  try {
    const res = await fetch("https://graph.instagram.com/v24.0/me?fields=user_id", {
      headers: { Authorization: `Bearer ${user.access_token}` },
      cache: "no-store",
    })
    const data = await res.json()
    if (data.error) {
      // 190 = token expired/invalidated (password change, logout, security reset).
      const reason = data.error.code === 190 ? "token_invalid" : "api_error"
      if (reason === "api_error") console.error("[status] Instagram error:", data.error.message)
      return NextResponse.json({ ok: reason !== "token_invalid", reason, expiresAt: user.token_expires_at })
    }
    return NextResponse.json({ ok: true, expiresAt: user.token_expires_at })
  } catch {
    // Network trouble is not a reason to nag the owner to reconnect.
    return NextResponse.json({ ok: true, reason: "unreachable", expiresAt: user.token_expires_at })
  }
}
