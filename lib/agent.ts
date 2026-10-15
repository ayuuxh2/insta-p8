// API for automation agents (e.g. the /novo-post-produto Claude skill).
// Every /api/agent/* request must send "Authorization: Bearer <AUTOMATION_API_KEY>".
import { createHash, timingSafeEqual } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

const digest = (s: string) => createHash("sha256").update(s).digest()

export function isAgentAuthorized(request: NextRequest): boolean {
  const key = process.env.AUTOMATION_API_KEY?.trim()
  if (!key || key.length < 32) return false
  const header = request.headers.get("authorization") || ""
  const sent = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  return timingSafeEqual(digest(sent), digest(key))
}

export const unauthorized = () => NextResponse.json({ error: "Chave de automação inválida" }, { status: 401 })

/**
 * The Instagram account the agent works on.
 *  - Without a request or an account hint: the FIRST username in ALLOWED_INSTAGRAM_USERNAMES (the env order decides,
 *    never the database order), so connecting more accounts never changes where publishing goes by default.
 *  - With `?account=@name` or the `X-Account` header: that account, only if it is allowed and connected. An unknown
 *    account returns user = null instead of silently falling back to another one.
 */
export async function agentUser(request?: NextRequest) {
  const db = await getSupabaseServerClient()
  const clean = (u: string) => u.trim().replace(/^@/, "").toLowerCase()
  const allowed = (process.env.ALLOWED_INSTAGRAM_USERNAMES || "").split(",").map(clean).filter(Boolean)
  const wanted = clean(request?.headers.get("x-account") || request?.nextUrl.searchParams.get("account") || "")
  const { data: users } = await db.from("users").select("id, username, access_token, business_account_id")
  const list = users || []
  const byName = (name: string) => list.find((u: any) => clean(String(u.username)) === name)
  if (wanted) return { db, user: allowed.includes(wanted) ? byName(wanted) || null : null }
  for (const name of allowed) {
    const found = byName(name)
    if (found) return { db, user: found }
  }
  return { db, user: list[0] || null }
}
