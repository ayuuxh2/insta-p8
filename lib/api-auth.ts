import crypto from "crypto"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Session handling for the dashboard API.
 *
 * Every API route reads/writes through the Supabase *service-role* client, which
 * bypasses RLS. Without a caller check, anyone could pass a `userId` and read or
 * mutate another account's automations, inbox, AI settings and send DMs as them.
 * These helpers are the single place that answers "is this caller allowed to act
 * for this userId?".
 *
 * The cookie is HMAC-signed so a session cannot be forged from a known user id.
 * Legacy unsigned cookies (`insta_session={"userId":...}`) are intentionally not
 * accepted — users re-connect Instagram once. That is the security fix.
 *
 * Signing key policy (hardening pass):
 *   - Production refuses to sign or accept sessions unless a dedicated,
 *     sufficiently long SESSION_SECRET is configured. The Instagram app secret
 *     is a *Meta* credential — reusing it as the session key means rotating it
 *     silently invalidates every session, and a leak of one leaks the other.
 *     So in production it is NOT used as a fallback.
 *   - Local development keeps the documented INSTAGRAM_APP_SECRET fallback so
 *     `next dev` works without extra setup; tests set SESSION_SECRET directly.
 */

/**
 * Lifetime of a signed session, in seconds. The cookie `maxAge` and the signed
 * `exp` claim both derive from this one value, so the browser dropping the
 * cookie and the server rejecting the session always coincide.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60

export interface SessionPayload {
  userId: string
  username?: string
  /** Issued-at, Unix seconds. */
  iat: number
  /** Expiry, Unix seconds. Enforced by the server, never by the browser alone. */
  exp: number
}

/** Fields a caller supplies when minting a session; `iat`/`exp` are derived. */
export interface SessionInput {
  userId: string
  username?: string
}

const COOKIE_NAME = "insta_session"

/** Minimum entropy we accept for the production session signing key. */
export const MIN_SESSION_SECRET_LENGTH = 32

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production"
}

function dedicatedSecret(): string | null {
  const value = process.env.SESSION_SECRET?.trim()
  return value ? value : null
}

/**
 * Resolve the session signing key, or null when the runtime is not allowed to
 * issue/verify sessions. Null always means "reject", never "trust unsigned".
 */
function sessionSecret(): string | null {
  const dedicated = dedicatedSecret()
  if (dedicated && dedicated.length >= MIN_SESSION_SECRET_LENGTH) return dedicated
  // Production must never fall back to a Meta credential or a weak secret.
  if (isProductionRuntime()) return null
  // Development only: documented compatibility fallback.
  if (dedicated) return dedicated
  return process.env.INSTAGRAM_APP_SECRET?.trim() || null
}

/**
 * Human-readable reason the session config is unusable, or null when it is fine.
 * Used to fail login with an actionable message instead of issuing a broken
 * (or unsigned) cookie. Never returns or logs the secret value itself.
 */
export function sessionSecretProblem(): string | null {
  const dedicated = dedicatedSecret()
  if (dedicated && dedicated.length >= MIN_SESSION_SECRET_LENGTH) return null
  if (!isProductionRuntime()) return null
  if (!dedicated) {
    return `SESSION_SECRET is not set. Set a dedicated random value of at least ${MIN_SESSION_SECRET_LENGTH} characters in production.`
  }
  return `SESSION_SECRET is too short (minimum ${MIN_SESSION_SECRET_LENGTH} characters). Generate one with: openssl rand -base64 48`
}

/** True when this runtime can safely sign/verify sessions. */
export function sessionSecretConfigured(): boolean {
  return sessionSecret() !== null
}

function sign(value: string, key: string): string {
  return crypto.createHmac("sha256", key).update(value).digest("base64url")
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * Serialize a dashboard session for the `insta_session` cookie.
 *
 * The signed payload includes `iat`/`exp` so expiry is part of the authenticated
 * data — a stolen cookie dies on its own instead of staying valid until the
 * signing key rotates. Throws when no signing key is available: an unsigned
 * cookie would be a forgeable bearer token, so we fail closed rather than mint
 * one.
 */
export function serializeSession(input: SessionInput): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    userId: String(input.userId),
    ...(input.username ? { username: input.username } : {}),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const key = sessionSecret()
  if (!key) {
    throw new Error(sessionSecretProblem() ?? "Session signing key is not configured")
  }
  return `${body}.${sign(body, key)}`
}

/**
 * Attributes to use whenever the session cookie is written.
 * httpOnly: the cookie is the API's authorization token, so JavaScript (and any
 * injected script) must not be able to read it. The client learns its identity
 * from /api/session instead.
 *
 * `maxAgeSeconds` defaults to the signed session lifetime so the cookie and the
 * server-enforced `exp` cannot drift apart.
 */
export function sessionCookieOptions(maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  return {
    name: COOKIE_NAME,
    path: "/",
    maxAge: maxAgeSeconds,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  }
}

/** Remove the session cookie (sign out). */
export function clearSessionCookie(response: { cookies: { set: (...args: any[]) => unknown } }): void {
  response.cookies.set(COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  })
}

/**
 * Parse and verify the `insta_session` cookie. Returns null when the cookie is
 * absent, has an invalid signature, is malformed, or has expired.
 *
 * Order matters: the signature is verified over the raw body *before* the
 * payload is parsed, so unauthenticated JSON is never interpreted. Expiry is
 * then enforced from the signed `exp` claim — the browser cookie lifetime is
 * advisory only and must never be the server's reason to trust a session.
 */
export function readSession(request: NextRequest): SessionPayload | null {
  try {
    const raw = request.cookies?.get(COOKIE_NAME)?.value
    if (!raw) return null

    // No usable key => no trustworthy sessions. Rejecting here is what stops a
    // misconfigured production deployment from accepting forged unsigned cookies.
    const key = sessionSecret()
    if (!key) return null

    const dot = raw.lastIndexOf(".")
    if (dot <= 0) return null
    const body = raw.slice(0, dot)
    const signature = raw.slice(dot + 1)
    if (!safeEqual(signature, sign(body, key))) return null

    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>
    if (!parsed || typeof parsed !== "object" || !parsed.userId) return null

    // A signed session must carry a numeric expiry; anything else is malformed
    // (e.g. a cookie minted before expiry existed) and must not be honoured.
    const { exp, iat } = parsed
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null
    const now = Math.floor(Date.now() / 1000)
    if (exp <= now) return null

    return {
      userId: String(parsed.userId),
      ...(parsed.username ? { username: parsed.username } : {}),
      iat: typeof iat === "number" && Number.isFinite(iat) ? iat : exp - SESSION_TTL_SECONDS,
      exp,
    }
  } catch {
    return null
  }
}

/**
 * Convenience for routes that only need the caller's id rather than the full
 * payload. Returns null when the request is unauthenticated or the session is
 * invalid/expired — callers must treat null as "not signed in", never as a
 * default user.
 */
export function getSessionUserId(request: NextRequest): string | null {
  return readSession(request)?.userId ?? null
}

/**
 * Guard for user-scoped routes: the caller must be signed in and may only act on
 * their own userId. Returns a 401 response to return, or null when allowed.
 */
export function requireUser(request: NextRequest, userId: string | null | undefined): NextResponse | null {
  const session = readSession(request)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!userId || String(userId) !== session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

/**
 * Guard for routes that address a record by id rather than userId. Loads
 * `column` from `table` and confirms it belongs to the caller, so user A cannot
 * read or mutate user B's row by guessing an id.
 */
export async function requireOwnedRow(
  request: NextRequest,
  supabase: any,
  table: string,
  column: string,
  id: string | null | undefined,
): Promise<{ denied: NextResponse } | { ownerId: string }> {
  const session = readSession(request)
  if (!session) return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!id) return { denied: NextResponse.json({ error: "Missing id" }, { status: 400 }) }

  const { data } = await supabase.from(table).select("user_id").eq(column, id).maybeSingle()
  if (!data || String(data.user_id) !== session.userId) {
    return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  }
  return { ownerId: session.userId }
}
