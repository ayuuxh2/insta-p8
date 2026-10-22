import { type NextRequest, NextResponse } from "next/server"
import { clearSessionCookie, readSession } from "@/lib/api-auth"

/**
 * Validates the dashboard session cookie.
 *
 * The dashboard keeps the connected account in localStorage, but every API route
 * authorises on the signed `insta_session` cookie. When the cookie is missing or
 * expired (for example an account that was connected before sessions were signed)
 * the dashboard would otherwise show empty data with no explanation, so the client
 * calls this endpoint on load and sends the user back to reconnect Instagram.
 */
export async function GET(request: NextRequest) {
  const session = readSession(request)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ userId: session.userId, username: session.username ?? null })
}

/** Sign out. The cookie is httpOnly, so only the server can clear it. */
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  clearSessionCookie(response)
  return response
}
