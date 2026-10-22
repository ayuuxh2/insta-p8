// Resolves every dependency of the callback/webhook routes to the consolidated
// stub module, while keeping lib/webhook-verify.ts real so the actual
// verification + delivery-detection logic is exercised (not a copy of it).
const here = import.meta.url
const stubs = new URL("./stubs.mjs", here).href
const dnsStub = new URL("./dns-stub.mjs", here).href

const stubbed = new Set([
  "next/server",
  "@/lib/supabase-server",
  "@/lib/supabase-migrate",
  "@/lib/instagram-api",
  "@/lib/ai-reply",
  "@/lib/unlock-tracking",
])

export async function resolve(specifier, context, next) {
  if (stubbed.has(specifier)) return { url: stubs, shortCircuit: true }
  // SSRF host resolution runs offline (own module so it does not form a cycle
  // with stubs.mjs re-exporting lib/instagram-api).
  if (specifier === "node:dns/promises") return { url: dnsStub, shortCircuit: true }
  // Real URL/SSRF helpers, so destination validation is genuinely exercised.
  if (specifier === "./url-safety") {
    return { url: new URL("../../lib/url-safety.ts", here).href, shortCircuit: true }
  }
  if (specifier === "./is-http-url") {
    return { url: new URL("../../lib/is-http-url.ts", here).href, shortCircuit: true }
  }
  // Real log sanitisation (no Node resolution of the @/ alias for new lib files).
  if (specifier === "@/lib/redact" || specifier === "./redact") {
    return { url: new URL("../../lib/redact.ts", here).href, shortCircuit: true }
  }
  if (specifier === "@/lib/webhook-verify") {
    return { url: new URL("../../lib/webhook-verify.ts", here).href, shortCircuit: true }
  }
  // Real auth guard so the authorization checks are exercised, not simulated.
  if (specifier === "@/lib/api-auth") {
    return { url: new URL("../../lib/api-auth.ts", here).href, shortCircuit: true }
  }
  // Real button contract, so API validation + serialization are genuinely tested.
  if (specifier === "@/lib/card-buttons") {
    return { url: new URL("../../lib/card-buttons.ts", here).href, shortCircuit: true }
  }
  // card-buttons.ts imports the URL helper with an extensionless relative path
  // (how TypeScript/Next resolve it); Node needs it mapped explicitly.
  if (specifier === "./instagram-api") return { url: stubs, shortCircuit: true }
  // The OAuth callback delegates Meta deliveries to the real webhook route.
  if (specifier === "../webhook/route" || specifier.endsWith("/webhook/route")) {
    return { url: new URL("../../app/api/instagram/webhook/route.ts", here).href, shortCircuit: true }
  }
  return next(specifier, context)
}
