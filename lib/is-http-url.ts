/**
 * Pure, client-safe URL syntax check.
 *
 * This module deliberately has NO Node built-in imports so it can be pulled into
 * browser bundles (the rule editor validates card buttons client-side). The
 * server-only SSRF destination guard lives in `lib/url-safety.ts`, which imports
 * `node:dns` and must never reach the client bundle.
 */

/**
 * True when `value` is a syntactically valid http(s) URL with a hostname.
 *
 * Uses the WHATWG URL parser instead of a prefix/prefix-regex check so that
 * malformed inputs such as `http://`, `https:`, `javascript:...`, `data:...`
 * and `file://...` are rejected. Hostnames are not resolved here — see
 * `resolvePublicHost` in `lib/url-safety.ts` for the network-destination check.
 */
export function isHttpUrl(value?: string | null): value is string {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0
  } catch {
    return false
  }
}
