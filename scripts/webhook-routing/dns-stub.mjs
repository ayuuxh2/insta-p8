// Stub for `node:dns/promises`.
//
// lib/url-safety.ts resolves a hostname before making any request, so the
// harness must be able to run offline. Everything resolves to a public address
// except the names the SSRF regression tests rely on, which resolve into
// private/loopback ranges.
export async function lookup(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".internal") || host === "internal.example") {
    return [{ address: "127.0.0.1", family: 4 }]
  }
  if (host === "private.example") return [{ address: "10.0.0.5", family: 4 }]
  // Exercises the DNS-failure path (the guard must not probe an unverified host).
  if (host === "unresolvable.example") throw new Error("ENOTFOUND")
  return [{ address: "93.184.216.34", family: 4 }]
}
