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

/** The connected Instagram account (single-owner app: the first allowed username). */
export async function agentUser() {
  const db = await getSupabaseServerClient()
  const allowed = (process.env.ALLOWED_INSTAGRAM_USERNAMES || "").split(",").map((u) => u.trim().replace(/^@/, "").toLowerCase()).filter(Boolean)
  const { data: users } = await db.from("users").select("id, username, access_token, business_account_id")
  const user = (users || []).find((u: any) => allowed.includes(String(u.username).toLowerCase())) || users?.[0]
  return { db, user: user || null }
}
