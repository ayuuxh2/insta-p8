import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { serializeSession, sessionCookieOptions, sessionSecretProblem } from "@/lib/api-auth"
import { handleWebhookVerification, isMetaWebhookDelivery } from "@/lib/webhook-verify"
// Reuse the real Instagram webhook processor. Importing the route module keeps a
// single source of truth for event handling instead of duplicating it here.
import { POST as handleMetaWebhookDelivery } from "../webhook/route"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Meta webhook verification (hub.* query params).
  // The canonical webhook endpoint is /api/instagram/webhook — that is where Meta
  // should deliver events. This branch exists so the OAuth callback also answers the
  // verification handshake, keeping webhook setup working for anyone who pointed the
  // Meta "Callback URL" at this route instead. Event POSTs are also handled here (see
  // POST below) and delegated to the webhook processor.
  if (searchParams.has("hub.mode")) {
    return handleWebhookVerification(searchParams)
  }

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

  return NextResponse.json({ error: "Invalid callback" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-hub-signature-256")

    // Meta delivers webhook event POSTs to whatever URL is registered as the
    // Instagram webhook "Callback URL" in the App Dashboard. When that still
    // points at this OAuth callback (the production 400 in the logs), incoming
    // DMs land here and used to fall through to the `{ code }` branch below,
    // failing with {"error":"No code"} and never reaching an automation.
    // A verified Meta delivery is handed to the same processor
    // /api/instagram/webhook uses, so replies work regardless of which URL the
    // dashboard advertises (the dashboard should still be pointed at
    // /api/instagram/webhook).
    if (isMetaWebhookDelivery(rawBody, signature)) {
      console.log(
        "[callback] Meta webhook delivery detected - delegating to the Instagram webhook processor",
      )
      return handleMetaWebhookDelivery(
        new NextRequest(request.url, {
          method: "POST",
          headers: request.headers,
          body: rawBody,
        }),
      )
    }

    // Fail before touching Instagram / the database when this deployment cannot
    // issue a trustworthy session. Minting an unsigned cookie would be worse
    // than a clear error, so this is a hard stop.
    const sessionProblem = sessionSecretProblem()
    if (sessionProblem) {
      console.error(`[callback] refusing login: ${sessionProblem}`)
      return NextResponse.json({ error: "Server session is not configured" }, { status: 500 })
    }

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: "No code" }, { status: 400 })
    }
    const code = body?.code
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 })

    // 1. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID
    const clientSecret = process.env.INSTAGRAM_APP_SECRET
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Missing Env Vars: Check INSTAGRAM_APP_ID")
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
        return NextResponse.json({ error: "Code already used" }, { status: 400 })
      }
      console.error("[v0] 🔴 Token Error:", JSON.stringify(tokenData, null, 2))
      return NextResponse.json({ error: tokenData.error_description || "Token failed" }, { status: 400 })
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
      console.log("[v0] 📋 /me response:", JSON.stringify(meData))

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

    const response = NextResponse.json({ success: true, username, userId: loginUserId, profilePic })
    const { name, ...cookieOptions } = sessionCookieOptions(expiresIn)
    response.cookies.set(name, serializeSession({ username, userId: loginUserId }), cookieOptions)
    return response

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
