import { NextResponse } from "next/server"

/**
 * Answers Meta's webhook verification handshake (the GET request Meta makes when
 * you add or re-verify a callback URL in the App Dashboard).
 *
 * Meta calls the subscribed URL with:
 *   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<random string>
 * and expects the *raw* `hub.challenge` echoed back as plain text with HTTP 200.
 * Anything else must fail with 403 (and never leak the expected token).
 *
 * The expected token is INSTAGRAM_WEBHOOK_VERIFY_TOKEN and is read at request
 * time so the same code path works for every route that receives the handshake.
 */
export function handleWebhookVerification(searchParams: URLSearchParams): NextResponse {
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN

  if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  }

  return NextResponse.json({ error: "Invalid verify token" }, { status: 403 })
}

/**
 * True when a POST body is a Meta webhook *delivery* rather than an OAuth
 * `{ code }` exchange.
 *
 * Meta signs every delivery, so an `x-hub-signature-256` header is the
 * strongest signal. The payload shape (`object` and/or `entry[]`) is checked as
 * a fallback for apps whose app secret is not configured on the server. An OAuth
 * body is `{ code: "..." }` and never matches either check, so this cannot
 * misroute login traffic.
 */
export function isMetaWebhookDelivery(rawBody: string, signatureHeader: string | null): boolean {
  if (signatureHeader?.startsWith("sha256=")) return true
  try {
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    return typeof parsed.object === "string" || Array.isArray(parsed.entry)
  } catch {
    return false
  }
}
