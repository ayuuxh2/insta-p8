// Instagram DM pipeline checks — no dependencies, no install required.
//
//   node scripts/webhook-routing/run.mjs
//
// Executes the real route modules with stubbed Supabase / Graph API so the whole
// DM path is covered: Meta verification -> delivery -> account lookup ->
// automation match -> DM send -> persistence.
import crypto from "node:crypto"
import assert from "node:assert/strict"
import { register } from "node:module"
import { state } from "./stubs.mjs"

process.env.INSTAGRAM_APP_ID = "1234567890"
process.env.INSTAGRAM_APP_SECRET = "test-secret"
process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI = "https://x/api/instagram/callback"
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "verify1234"
delete process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK

register("./loader.mjs", import.meta.url)

const cb = await import(new URL("../../app/api/instagram/callback/route.ts", import.meta.url).href)
const wh = await import(new URL("../../app/api/instagram/webhook/route.ts", import.meta.url).href)

const IG_ID = "17841400000000000"

function fakeRequest({ url, query, body, headers } = {}) {
  const u = new URL(url)
  if (query) u.search = query
  return {
    url: u.href,
    headers: new Headers(headers),
    nextUrl: { searchParams: u.searchParams },
    text: async () => body ?? "",
  }
}

function delivery(text, mid = "m1") {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ID,
        time: 1,
        messaging: [
          { sender: { id: "ig_scoped_sender" }, recipient: { id: IG_ID }, timestamp: 1, message: { mid, text } },
        ],
      },
    ],
  })
}

const sign = (raw, secret = "test-secret") =>
  "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")

const results = []
const check = (name, fn) => {
  try { fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${e.message}`) }
}

// A. webhook verification (canonical endpoint)
{
  const res = await wh.GET(fakeRequest({
    url: "https://x/api/instagram/webhook",
    query: "hub.mode=subscribe&hub.verify_token=verify1234&hub.challenge=TEST123",
  }))
  check("A GET /api/instagram/webhook valid token -> 200 TEST123 text/plain", () => {
    assert.equal(res.status, 200)
    assert.equal(res.body, "TEST123")
    assert.equal(res.headers.get("content-type"), "text/plain")
  })
}

// A2. verification also answered on the OAuth callback
{
  const res = await cb.GET(fakeRequest({
    url: "https://x/api/instagram/callback",
    query: "hub.mode=subscribe&hub.verify_token=verify1234&hub.challenge=TEST123",
  }))
  check("A2 GET /api/instagram/callback valid token -> 200 TEST123", () => {
    assert.equal(res.status, 200)
    assert.equal(res.body, "TEST123")
  })
}

// B. invalid verification token -> 403
{
  const res = await wh.GET(fakeRequest({
    url: "https://x/api/instagram/webhook",
    query: "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=TEST123",
  }))
  check("B invalid verify token -> 403", () => assert.equal(res.status, 403))
}

// C. OAuth redirect behaviour preserved
{
  const ok = await cb.GET(fakeRequest({ url: "https://x/api/instagram/callback", query: "code=abc123" }))
  const err = await cb.GET(fakeRequest({ url: "https://x/api/instagram/callback", query: "error=access_denied" }))
  const bad = await cb.GET(fakeRequest({ url: "https://x/api/instagram/callback" }))
  check("C OAuth GET redirects (?code, ?error) and 400s otherwise", () => {
    assert.ok(ok.__redirect.includes("code=abc123"))
    assert.ok(err.__redirect.includes("error=access_denied"))
    assert.equal(bad.status, 400)
  })
}

// D. ROOT CAUSE: a Meta DM delivered to the OAuth callback must still reply
{
  const raw = delivery("price")
  const before = state.sent
  const res = await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw) },
  }))
  check("D DM POST to /api/instagram/callback is processed (reply sent)", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent - before, 1, "expected exactly one DM reply")
    assert.equal(state.lastSend.text, "499")
  })
  check("D2 incoming + outgoing messages persisted", () => {
    assert.ok(state.saved.some((r) => r.is_from_instagram === true), "incoming saved")
    assert.ok(state.saved.some((r) => r.is_from_instagram === false), "outgoing saved")
  })
  check("D3 webhook_events audit written", () => {
    assert.ok(state.audit.length >= 1)
    assert.equal(state.audit[0].event_type, "instagram")
    assert.equal(state.audit[0].data.events[0].kind, "message")
  })
}

// D4. non-matching DM does not reply
{
  const raw = delivery("hello there", "m2")
  const before = state.sent
  await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw) },
  }))
  check("D4 unmatched DM does not send a reply", () => assert.equal(state.sent - before, 0))
}

// D5. bad signature is rejected (security preserved)
{
  const raw = delivery("price", "m3")
  const before = state.sent
  const res = await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw, "wrong-secret") },
  }))
  check("D5 tampered signature -> 401 and no reply", () => {
    assert.equal(res.status, 401)
    assert.equal(state.sent - before, 0)
  })
}

// E. canonical webhook POST still replies
{
  const raw = delivery("price", "m4")
  const before = state.sent
  const res = await wh.POST(fakeRequest({
    url: "https://x/api/instagram/webhook",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw) },
  }))
  check("E POST /api/instagram/webhook replies", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent - before, 1)
  })
}

// F. OAuth code exchange via POST still works (no signature header => not a webhook)
{
  global.fetch = async (url) => {
    const s = String(url)
    if (s.includes("api.instagram.com/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "short", user_id: 256123 }) }
    }
    if (s.includes("access_token?grant_type=ig_exchange_token")) {
      return { ok: true, json: async () => ({ access_token: "long", expires_in: 5184000 }) }
    }
    if (s.includes("graph.instagram.com/v24.0/me")) {
      return { ok: true, json: async () => ({ user_id: IG_ID, username: "creator", profile_picture_url: "http://pic" }) }
    }
    return { ok: false, json: async () => ({}) }
  }
  const res = await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: JSON.stringify({ code: "the-code" }),
  }))
  check("F OAuth POST {code} still exchanges + persists the IG account id", () => {
    assert.equal(res._json?.success, true)
    assert.equal(state.upserts.length, 1)
    assert.equal(state.upserts[0].business_account_id, IG_ID)
    assert.equal(state.upserts[0].page_id, IG_ID)
  })
}

// G. empty POST body -> 400 No code (unchanged contract)
{
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: "{}" }))
  check("G POST without code -> 400 No code", () => assert.equal(res.status, 400))
}

console.log(results.join("\n"))
const failed = results.filter((r) => r.startsWith("FAIL"))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
