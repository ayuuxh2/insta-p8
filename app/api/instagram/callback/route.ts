import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("error", error)
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("code", code)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.json({ error: "Callback inválido" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code } = body
    if (!code) return NextResponse.json({ error: "Código ausente" }, { status: 400 })

    // 1. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID?.trim()
    const clientSecret = process.env.INSTAGRAM_APP_SECRET?.trim()
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI?.trim()

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Variáveis de ambiente ausentes: verifique INSTAGRAM_APP_ID")
    }

    // 2. Exchange Code for Short Token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    })

    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      if (tokenData.error_message?.includes("authorization code has been used")) {
        // Harmless double-fire from React StrictMode or double clicks
        return NextResponse.json({ error: "Código já utilizado" }, { status: 400 })
      }
      console.error("[v0] 🔴 Token Error:", tokenData.error_type, tokenData.error_message)
      return NextResponse.json({ error: tokenData.error_description || "Falha ao obter o token" }, { status: 400 })
    }

    const shortToken = tokenData.access_token
    const loginUserId = tokenData.user_id.toString()

    // 3. Exchange for Long Token (60 Days)
    const longLivedUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
    const longRes = await fetch(longLivedUrl)
    const longData = await longRes.json()
    const accessToken = longData.access_token || shortToken
    const expiresIn = longData.expires_in || 5184000

    // 4. Get Username + IG Professional Account ID (webhook-matching ID)
    // Per Meta docs: /me?fields=user_id returns the IG_ID that matches webhook entry.id
    // https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started
    let username = `user_${loginUserId}`
    let businessAccountId = loginUserId // fallback
    let profilePic: string | null = null

    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v24.0/me?fields=user_id,username,profile_picture_url&access_token=${accessToken}`
      )
      const meData = await meRes.json()

      if (meData.username) username = meData.username
      if (meData.profile_picture_url) profilePic = meData.profile_picture_url
      if (meData.user_id) {
        businessAccountId = meData.user_id.toString()
        console.log(`[v0] 🎯 Got IG Professional Account ID (user_id): ${businessAccountId}`)
      } else {
        console.warn(`[v0] ⚠️ /me did not return user_id, using loginUserId: ${loginUserId}`)
      }
    } catch (e) {
      console.error("[v0] /me request failed:", e)
    }

    // 5. Only accounts listed in ALLOWED_INSTAGRAM_USERNAMES may be connected.
    const allowed = (process.env.ALLOWED_INSTAGRAM_USERNAMES || "")
      .split(",")
      .map(name => name.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
    if (!allowed.includes(username.toLowerCase())) {
      console.warn(`[callback] Rejected Instagram account @${username}: not in ALLOWED_INSTAGRAM_USERNAMES`)
      return NextResponse.json({ error: `A conta @${username} não está autorizada neste painel` }, { status: 403 })
    }

    // 6. Save/Update User
    const supabase = await getSupabaseServerClient()

    const updates: any = {
      username,
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      business_account_id: businessAccountId,
      page_id: businessAccountId, // Always keep in sync
    }

    console.log(`[v0] 💾 Saving user: ${username} | id=${loginUserId} | biz_id=${businessAccountId}`)

    const { error: upsertError } = await supabase
      .from("users")
      .upsert({ id: loginUserId, ...updates }, { onConflict: "id" })

    if (upsertError) throw upsertError

    // 7. Subscribe the account to webhook events; without this Meta delivers nothing.
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/v24.0/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const subData = await subRes.json()
      if (!subRes.ok || !subData.success) {
        console.error("[callback] Webhook subscription failed:", subData.error?.message || subData)
      }
    } catch (e) {
      console.error("[callback] Webhook subscription request failed:", e)
    }

    return NextResponse.json({ success: true, username, userId: loginUserId, profilePic })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
