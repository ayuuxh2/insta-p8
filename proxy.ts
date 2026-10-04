import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

// Everything requires the owner session except these.
function isPublic(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  if (pathname === "/login" || pathname === "/privacy" || pathname === "/exclusao-de-dados") return true
  if (pathname === "/api/auth/login") return true
  // Meta calls the webhook directly; it is protected by the X-Hub-Signature-256 check.
  if (pathname === "/api/instagram/webhook") return true
  // Short links sent to customers in DMs.
  if (pathname.startsWith("/r/")) return true
  // Automation agents (Claude skill); the routes check AUTOMATION_API_KEY themselves.
  if (pathname.startsWith("/api/agent/")) return true
  // Vercel Cron; the route checks CRON_SECRET itself.
  if (pathname.startsWith("/api/cron/")) return true
  // The OAuth redirect only forwards ?code to the dashboard; the token exchange (POST) stays protected.
  if (pathname === "/api/instagram/callback" && request.method === "GET") return true
  return false
}

export async function proxy(request: NextRequest) {
  if (isPublic(request)) return NextResponse.next()

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Skip Next internals and static files from /public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
