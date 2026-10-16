// Single-owner dashboard auth: a password (ADMIN_PASSWORD) exchanged for an
// HMAC-signed, httpOnly session cookie. Uses Web Crypto so it runs both in the
// proxy and in route handlers.

export const SESSION_COOKIE = "admin_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

const encoder = new TextEncoder()

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters")
  }
  return secret
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  return Buffer.from(sig).toString("base64url")
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE
  const payload = `v1.${expiresAt}`
  return `${payload}.${await hmac(payload)}`
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const lastDot = token.lastIndexOf(".")
  if (lastDot < 0) return false
  const payload = token.slice(0, lastDot)
  const signature = token.slice(lastDot + 1)
  const [version, exp] = payload.split(".")
  if (version !== "v1" || !exp || Number(exp) < Date.now() / 1000) return false
  try {
    return safeEqual(signature, await hmac(payload))
  } catch {
    return false
  }
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected || expected.length < 12) {
    throw new Error("ADMIN_PASSWORD is missing or shorter than 12 characters")
  }
  // Compare HMACs so the comparison time does not depend on the password length.
  return safeEqual(await hmac(`pw:${candidate}`), await hmac(`pw:${expected}`))
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  }
}
