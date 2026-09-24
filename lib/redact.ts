/**
 * Log sanitisation.
 *
 * Access tokens travel in query strings on every Graph API call
 * (`.../me/messages?access_token=...`). When a fetch fails, the thrown error (or
 * the response body an upstream echoes back) frequently embeds that full URL, so
 * logging the raw error publishes the account's credentials. Every log sink that
 * can receive network error text must pass it through `redactSecrets` first.
 *
 * This removes credential-bearing query parameters and any configured secret
 * value, and never reveals the secret itself.
 */
const SECRET_QUERY_PARAM = /([?&](?:access_token|client_secret|verify_token|token|code)=)[^&\s"'\\]+/gi

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause
    return `${value.name}: ${value.message}${cause ? ` (${stringify(cause)})` : ""}`
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Return a log-safe representation of `value` with credentials masked.
 * Accepts a string, Error (including `.cause`) or any JSON-serialisable value.
 */
export function redactSecrets(value: unknown): string {
  let text = stringify(value)
  text = text.replace(SECRET_QUERY_PARAM, "$1***")

  // Belt-and-braces: mask the configured secret values wherever they appear,
  // even outside a query string. Short values are skipped so this can never
  // mangle ordinary log text.
  for (const secret of [
    process.env.INSTAGRAM_APP_SECRET,
    process.env.META_APP_SECRET,
    process.env.SESSION_SECRET,
  ]) {
    const trimmed = secret?.trim()
    if (trimmed && trimmed.length >= 8) text = text.split(trimmed).join("***")
  }
  return text
}
