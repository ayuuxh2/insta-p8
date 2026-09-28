import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const clientId = process.env.INSTAGRAM_APP_ID || process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID
  const origin = request.nextUrl.origin
  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI ||
    process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI ||
    `${origin}/api/instagram/callback`

  if (!clientId) {
    // If running in development without credentials, provide a clear helpful message
    return NextResponse.json(
      {
        error: "INSTAGRAM_APP_ID is not configured in environment variables.",
        hint: "Please set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET in your .env or platform environment variables.",
      },
      { status: 500 }
    )
  }

  const authUrl = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=instagram_business_basic%2Cinstagram_business_manage_messages%2Cinstagram_business_manage_comments`

  return NextResponse.redirect(authUrl)
}
