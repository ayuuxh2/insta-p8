import crypto from "crypto"
import { NextResponse } from "next/server"

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
}

/**
 * Secrets that may legitimately sign a Meta delivery. Meta signs the app the
 * webhooks are configured on; depending on setup that is the Instagram app
 * secret or the parent Meta app secret. Read at request time so a rotated
 * secret (or a test's env) is honoured without a cold start.
 */
export function metaAppSecrets(): string[] {
  return [process.env.INSTAGRAM_APP_SECRET, process.env.META_APP_SECRET].filter(
    (s): s is string => Boolean(s && s.trim()),
  )
}

/**
 * Verify Meta's `X-Hub-Signature-256` header against the *raw* request body.
 *
 * HMAC-SHA256 over the exact bytes Meta sent — verifying a re-serialized JSON
 * body would fail for any payload whose key order/whitespace differs, and would
 * silently accept body mutation. Comparison is timing-safe and length-checked.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets: string[],
): boolean {
  if (secrets.length === 0 || !signatureHeader?.startsWith("sha256=")) return false
  const received = signatureHeader.slice("sha256=".length)
  // A valid hex SHA-256 digest is exactly 64 chars; anything else is malformed.
  if (received.length !== 64) return false
  return secrets.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
    return (
      received.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"))
    )
  })
}

/**
 * Local-debug escape hatch for signature verification.
 *
 * Deliberately impossible to arm in production: a deployment that could be told
 * to skip HMAC verification is an unauthenticated webhook endpoint, which lets
 * anyone forge DMs/comments and send messages as the connected account. When the
 * variable is seen in production it is logged once (loudly) and ignored.
 */
export function signatureBypassEnabled(): boolean {
  if (process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK !== "true") return false
  if (isProductionRuntime()) {
    console.error(
      "[webhook] DISABLE_WEBHOOK_SIGNATURE_CHECK=true is set in production and is being IGNORED — signatures are still enforced. Remove this environment variable.",
    )
    return false
  }
  console.warn(
    "[webhook] DISABLE_WEBHOOK_SIGNATURE_CHECK=true — signature verification bypassed (development only)",
  )
  return true
}

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
