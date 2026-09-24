import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { serializeSession, sessionCookieOptions } from "@/lib/api-auth"

/**
 * POST /api/instagram/test-login
 * Creates a mock user for local development — no Instagram OAuth needed.
 */
export async function POST(request: NextRequest) {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not available in production" }, { status: 403 })
    }

    const TEST_USER_ID = "9999999999"
    const TEST_USERNAME = "test_creator"

    const supabase = await getSupabaseServerClient()

    const { error: upsertError } = await supabase
      .from("users")
      .upsert(
        {
          id: TEST_USER_ID,
          username: TEST_USERNAME,
          access_token: "TEST_TOKEN_NOT_REAL",
          token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          business_account_id: TEST_USER_ID,
          page_id: TEST_USER_ID,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )

    if (upsertError) {
      console.error("[test-login] Supabase upsert error:", upsertError)
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    const response = NextResponse.json({
      success: true,
      username: TEST_USERNAME,
      userId: TEST_USER_ID,
    })
    // Same signed-session lifetime as the real login path (default = SESSION_TTL_SECONDS).
    const { name, ...cookieOptions } = sessionCookieOptions()
    response.cookies.set(name, serializeSession({ username: TEST_USERNAME, userId: TEST_USER_ID }), {
      ...cookieOptions,
      secure: false,
    })

    return response
  } catch (error: any) {
    console.error("[test-login] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
