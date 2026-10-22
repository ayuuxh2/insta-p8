// Instagram DM pipeline checks — no dependencies, no install required.
//
//   node scripts/webhook-routing/run.mjs
//
// Executes the real route modules with stubbed Supabase / Graph API so the whole
// DM path is covered: Meta verification -> delivery -> account lookup ->
// automation match -> DM send -> persistence.
//
// Node version: this harness imports the real `.ts` modules directly, which needs
// Node's native TypeScript type stripping. Supported configurations:
//   * Node.js 22.18+   (type stripping on by default)
//   * Node.js 23.6+    (type stripping on by default)
//   * Node.js 22.6+    with `node --experimental-strip-types`
// Older releases cannot load the route modules and will fail on import.
import crypto from "node:crypto"
import assert from "node:assert/strict"
import { register } from "node:module"

process.env.INSTAGRAM_APP_ID = "1234567890"
process.env.INSTAGRAM_APP_SECRET = "test-secret"
process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI = "https://x/api/instagram/callback"
process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "verify1234"
process.env.SESSION_SECRET = "test-session-secret"
delete process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK

register("./loader.mjs", import.meta.url)

// Imported after `register` so the stubs module (which re-exports lib modules)
// is resolved through the loader hook rather than Node's default resolver.
const { state } = await import("./stubs.mjs")

const cb = await import(new URL("../../app/api/instagram/callback/route.ts", import.meta.url).href)
const wh = await import(new URL("../../app/api/instagram/webhook/route.ts", import.meta.url).href)
const autos = await import(new URL("../../app/api/automations/route.ts", import.meta.url).href)
const session = await import(new URL("../../app/api/session/route.ts", import.meta.url).href)
const media = await import(new URL("../../app/api/instagram/media/route.ts", import.meta.url).href)
const testLogin = await import(new URL("../../app/api/instagram/test-login/route.ts", import.meta.url).href)
const iceBreakers = await import(new URL("../../app/api/ice-breakers/route.ts", import.meta.url).href)
// Real modules (no stubs involved) so these paths are genuinely exercised.
const realIg = await import(new URL("../../lib/instagram-api.ts", import.meta.url).href)
const auth = await import(new URL("../../lib/api-auth.ts", import.meta.url).href)
const cardLib = await import(new URL("../../lib/card-buttons.ts", import.meta.url).href)

const SESSION = auth.serializeSession({ userId: "256123", username: "creator" })

const IG_ID = "17841400000000000"

function fakeRequest({ url, query, body, headers, session } = {}) {
  const u = new URL(url)
  if (query) u.search = query
  return {
    url: u.href,
    headers: new Headers(headers),
    nextUrl: { searchParams: u.searchParams },
    cookies: { get: (name) => (session && name === "insta_session" ? { value: session } : undefined) },
    text: async () => body ?? "",
    json: async () => JSON.parse(body ?? "{}"),
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
  check("F2 login issues an httpOnly session cookie for the signed session lifetime", () => {
    assert.equal(res._cookie?.name, "insta_session")
    assert.ok(res._cookie?.value, "cookie value must be set")
    assert.equal(res._cookie?.options?.httpOnly, true)
    assert.equal(res._cookie?.options?.maxAge, auth.SESSION_TTL_SECONDS)
  })
}

// G. empty POST body -> 400 No code (unchanged contract)
{
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: "{}" }))
  check("G POST without code -> 400 No code", () => assert.equal(res.status, 400))
}

// H. CARD / LINK: every configured field reaches the sender intact
{
  state.automations = [
    {
      id: "card1",
      user_id: "256123",
      name: "Guide card",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "guide",
      response_content: {
        card: {
          title: "Super",
          subtitle: "Here is what you wanted",
          image_url: "https://example.com/cover.png",
          url: "https://example.com/landing",
          buttons: [{ type: "web_url", title: "Open", url: "https://example.com/landing" }],
        },
      },
      is_active: true,
    },
  ]
  state.cardSent = 0
  state.lastCard = null
  const raw = delivery("guide", "m5")
  await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw) },
  }))
  check("H Card/Link config reaches the sender with url + image_url + buttons", () => {
    assert.equal(state.cardSent, 1, "card template must be sent")
    assert.deepEqual(state.lastCard, {
      title: "Super",
      subtitle: "Here is what you wanted",
      image_url: "https://example.com/cover.png",
      url: "https://example.com/landing",
      buttons: [{ type: "web_url", title: "Open", url: "https://example.com/landing" }],
    })
  })
}

// I. The Graph payload itself carries the link, image and buttons
{
  const att = realIg.buildCardAttachment({
    title: "Super",
    subtitle: "Here is what you wanted",
    image_url: "https://example.com/cover.png",
    url: "https://example.com/landing",
    buttons: [{ type: "web_url", title: "Open", url: "https://example.com/landing" }],
  })
  const el = att.attachment.payload.elements[0]
  check("I generic template carries default_action (link), image_url, subtitle, buttons", () => {
    assert.equal(att.attachment.type, "template")
    assert.equal(att.attachment.payload.template_type, "generic")
    assert.equal(el.default_action.url, "https://example.com/landing")
    assert.equal(el.image_url, "https://example.com/cover.png")
    assert.equal(el.subtitle, "Here is what you wanted")
    assert.deepEqual(el.buttons, [{ type: "web_url", title: "Open", url: "https://example.com/landing" }])
  })

  const bare = realIg.buildCardAttachment({ title: "Only title", subtitle: "", image_url: "", url: "", buttons: [] })
  const bareEl = bare.attachment.payload.elements[0]
  check("I2 empty image/link/buttons are omitted (no invalid empty button array)", () => {
    assert.equal("image_url" in bareEl, false)
    assert.equal("default_action" in bareEl, false)
    assert.equal("buttons" in bareEl, false)
  })

  const clamped = realIg.buildCardAttachment({ title: "x".repeat(120), buttons: [] })
  check("I3 title/subtitle are clamped to Instagram's 80-char limit", () => {
    assert.equal(clamped.attachment.payload.elements[0].title.length, 80)
  })
}

// J. A rejected card is not silently dropped — the link still gets delivered
{
  state.failCardTemplate = true
  state.sent = 0
  state.lastSend = null
  const raw = delivery("guide", "m6")
  await cb.POST(fakeRequest({
    url: "https://x/api/instagram/callback",
    body: raw,
    headers: { "x-hub-signature-256": sign(raw) },
  }))
  check("J rejected card falls back to a supported message containing the link", () => {
    assert.ok(state.cardSent >= 1, "template attempted")
    assert.ok(state.lastSend, "fallback text must be sent")
    assert.ok(state.lastSend.text.includes("https://example.com/landing"), "link must still reach the recipient")
  })
  state.failCardTemplate = false
}

// K. Image URL validation (the Bing-page case from the bug report)
{
  global.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "text/html; charset=utf-8" }) })
  const page = await realIg.validateImageUrl("https://www.bing.com/images/search?view=detailv2&id=abc")
  global.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "image/png" }) })
  const img = await realIg.validateImageUrl("https://example.com/cover.png")
  global.fetch = async () => { throw new Error("offline") }
  const unknown = await realIg.validateImageUrl("https://cdn.example.com/xyz")
  check("K image validation rejects web pages, accepts images, tolerates unverifiable URLs", () => {
    assert.equal(page.valid, false)
    assert.equal(img.valid, true)
    assert.equal(unknown.valid, true)
  })
}

// K2. SSRF: the image probe must not connect to private/internal destinations,
// and must not trust URL syntax alone (a metadata IP is a valid-looking URL).
{
  const prevFetch = global.fetch
  const requested = []
  global.fetch = async (url) => {
    requested.push(String(url))
    return { ok: true, headers: new Headers({ "content-type": "image/png" }) }
  }
  const loopback = await realIg.validateImageUrl("http://127.0.0.1/secret.png")
  const namedLocalhost = await realIg.validateImageUrl("http://localhost/secret.png")
  const internal = await realIg.validateImageUrl("http://internal.example/secret.png")
  const metadata = await realIg.validateImageUrl("http://169.254.169.254/latest/meta-data/")
  const privateName = await realIg.validateImageUrl("https://private.example/cover.png")
  const unresolvable = await realIg.validateImageUrl("https://unresolvable.example/cover.png")
  const publicOk = await realIg.validateImageUrl("https://example.com/cover.png")
  global.fetch = prevFetch
  check("K2 private, loopback and metadata destinations are rejected without a request", () => {
    for (const result of [loopback, namedLocalhost, internal, metadata, privateName, unresolvable]) {
      assert.equal(result.valid, false, "unverified destination must be rejected")
    }
    assert.equal(publicOk.valid, true)
    assert.deepEqual(requested, ["https://example.com/cover.png"], "only public destinations may be fetched")
  })
}

// K3. Redirects are re-validated at every hop, so a public URL cannot bounce the
// server into the internal network.
{
  const prevFetch = global.fetch
  const redirecting = (location) => async (url) =>
    String(url).endsWith("/public.png")
      ? { ok: false, status: 302, headers: new Headers({ location }) }
      : { ok: true, headers: new Headers({ "content-type": "image/png" }) }

  global.fetch = redirecting("http://127.0.0.1/secret.png")
  const bounced = await realIg.validateImageUrl("https://example.com/public.png")
  global.fetch = redirecting("https://cdn.example.com/final.png")
  const publicRedirect = await realIg.validateImageUrl("https://example.com/public.png")
  global.fetch = prevFetch

  check("K3 a redirect into a private address is rejected; a public redirect validates", () => {
    assert.equal(bounced.valid, false)
    assert.equal(publicRedirect.valid, true)
  })
}

// K4. isHttpUrl parses the URL instead of prefix-matching it.
{
  const syntacticallyValid = ["https://example.com/x", "http://example.com", "  https://example.com/x  "]
  const syntacticallyInvalid = [
    "",
    "http://",
    "https://",
    "http:",
    "https:",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "not a url",
  ]
  check("K4 isHttpUrl accepts real http(s) URLs and rejects malformed/non-http schemes", () => {
    for (const url of syntacticallyValid) assert.equal(realIg.isHttpUrl(url), true, `expected valid: ${JSON.stringify(url)}`)
    for (const url of syntacticallyInvalid)
      assert.equal(realIg.isHttpUrl(url), false, `expected invalid: ${JSON.stringify(url)}`)
    // Host-local names stay syntactically valid — the SSRF guard is what rejects
    // them, which is why the two checks are separate.
    assert.equal(realIg.isHttpUrl("http://localhost"), true)
    assert.equal(realIg.isHttpUrl("http://127.0.0.1"), true)
  })
}

// L. Save-time validation: a web-page image URL is rejected with a clear message
{
  const cardBody = (image) =>
    JSON.stringify({
      userId: "256123",
      name: "Card rule",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "guide",
      content: {
        card: {
          title: "Super",
          subtitle: "Here is what you wanted",
          image_url: image,
          url: "https://example.com/landing",
          buttons: [],
        },
      },
    })

  global.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "text/html; charset=utf-8" }) })
  const bad = await autos.POST(fakeRequest({
    url: "https://x/api/automations",
    body: cardBody("https://www.bing.com/images/search?view=detailv2&id=abc"),
    session: SESSION,
  }))

  global.fetch = async () => ({ ok: true, headers: new Headers({ "content-type": "image/png" }) })
  const good = await autos.POST(fakeRequest({
    url: "https://x/api/automations",
    body: cardBody("https://example.com/cover.png"),
    session: SESSION,
  }))

  check("L web-page image URL is rejected at save time with a clear message", () => {
    assert.equal(bad.status, 400)
    assert.match(bad._json.error, /image/i)
  })
  check("L2 a real image URL saves successfully", () => assert.equal(good.status, 200))
}

// M. A retried webhook delivery must not produce a second reply
{
  state.automations = [
    {
      id: "rule1",
      user_id: "256123",
      name: "Price rule",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "price",
      response_content: { message: "499" },
      is_active: true,
    },
  ]
  const raw = delivery("price", "dup-mid-1")
  const headers = { "x-hub-signature-256": sign(raw) }
  const before = state.sent
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  const afterFirst = state.sent
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  check("M duplicate webhook delivery does not send a second reply", () => {
    assert.equal(afterFirst - before, 1, "first delivery replies once")
    assert.equal(state.sent - before, 1, "retry must be ignored")
  })
}

// Q. A retried comment delivery must not reply publicly twice
{
  state.automations = [
    {
      id: "comment1",
      user_id: "256123",
      name: "Comment rule",
      trigger_source: "comment",
      trigger_type: "keyword",
      trigger_value: "price",
      response_content: { message: "Sent you a DM!" },
      is_active: true,
    },
  ]
  const comment = (commentId) =>
    JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: IG_ID,
          time: 1,
          changes: [
            {
              field: "comments",
              value: {
                id: commentId,
                text: "price please",
                from: { id: "ig_commenter" },
                media: { id: "media1", media_product_type: "FEED" },
                parent_id: null,
              },
            },
          ],
        },
      ],
    })
  const raw = comment("comment-1")
  const headers = { "x-hub-signature-256": sign(raw) }
  state.commentReplies = 0
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  const afterFirst = state.commentReplies
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  check("Q duplicate comment delivery replies once", () => {
    assert.equal(afterFirst, 1, "first delivery replies once")
    assert.equal(state.commentReplies, 1, "retry must be ignored")
  })
}

// N. Authorization: user-scoped routes require a verified session
{
  const anon = await autos.GET(fakeRequest({ url: "https://x/api/automations", query: "userId=256123" }))
  const foreign = await autos.GET(fakeRequest({ url: "https://x/api/automations", query: "userId=999999", session: SESSION }))
  check("N unauthenticated request is rejected (401)", () => assert.equal(anon.status, 401))
  check("N2 a session cannot act as another userId (401)", () => assert.equal(foreign.status, 401))
}

// N3. Ownership: ids cannot be used to reach another account's rows
{
  state.automations = [
    {
      id: "foreign",
      user_id: "999999",
      name: "Not yours",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "x",
      response_content: { message: "x" },
      is_active: true,
    },
  ]
  const res = await autos.DELETE(fakeRequest({ url: "https://x/api/automations?id=foreign", session: SESSION }))
  check("N3 another account's automation cannot be deleted (404)", () => assert.equal(res.status, 404))
  state.automations = []
}

// P. Session endpoint: the dashboard can tell a live session from a stale one
{
  const ok = await session.GET(fakeRequest({ url: "https://x/api/session", session: SESSION }))
  const anon = await session.GET(fakeRequest({ url: "https://x/api/session" }))
  const forged = await session.GET(
    fakeRequest({ url: "https://x/api/session", session: Buffer.from(JSON.stringify({ userId: "999999" })).toString("base64url") }),
  )
  check("P GET /api/session validates a signed session", () => {
    assert.equal(ok.status, 200)
    assert.equal(ok._json.userId, "256123")
    assert.equal(anon.status, 401)
    assert.equal(forged.status, 401, "an unsigned cookie must not be trusted")
  })
}

// P2. Logout clears the httpOnly session cookie server-side
{
  const res = await session.DELETE(fakeRequest({ url: "https://x/api/session" }))
  check("P2 DELETE /api/session clears the session cookie", () => {
    assert.equal(res.status, 200)
    assert.equal(res._cookie?.name, "insta_session")
    assert.equal(res._cookie?.options?.maxAge, 0)
  })
}

// S. Production session policy: dedicated strong SESSION_SECRET, no unsigned trust
{
  const prevEnv = process.env.NODE_ENV
  const prevSecret = process.env.SESSION_SECRET
  process.env.NODE_ENV = "production"
  process.env.SESSION_SECRET = "too-short"
  const problem = auth.sessionSecretProblem()
  let throws = false
  try {
    auth.serializeSession({ userId: "256123" })
  } catch {
    throws = true
  }
  const unsigned = auth.readSession(
    fakeRequest({ url: "https://x/api/session", session: Buffer.from(JSON.stringify({ userId: "256123" })).toString("base64url") }),
  )
  process.env.SESSION_SECRET = "x".repeat(48)
  const fixedProblem = auth.sessionSecretProblem()
  const accepted = auth.readSession(
    fakeRequest({ url: "https://x/api/session", session: auth.serializeSession({ userId: "256123" }) }),
  )
  process.env.NODE_ENV = prevEnv
  process.env.SESSION_SECRET = prevSecret
  check("S production requires a dedicated strong SESSION_SECRET and rejects unsigned cookies", () => {
    assert.match(problem, /SESSION_SECRET/)
    assert.equal(throws, true, "a missing/weak secret must refuse to mint a session")
    assert.equal(unsigned, null, "an unsigned cookie must never be trusted")
    assert.equal(fixedProblem, null)
    assert.equal(accepted?.userId, "256123")
  })
}

// S2. A signed cookie whose payload was edited is rejected
{
  const signature = SESSION.split(".").pop()
  const tampered =
    Buffer.from(JSON.stringify({ userId: "999999", username: "creator" })).toString("base64url") + "." + signature
  const parsed = auth.readSession(fakeRequest({ url: "https://x/api/session", session: tampered }))
  check("S2 a tampered signed cookie is rejected", () => assert.equal(parsed, null))
}

// S3. Server-enforced expiry: exp is part of the signed payload and the server
// rejects expired/malformed sessions even while the browser cookie is present.
{
  const now = Math.floor(Date.now() / 1000)
  const sessionKey = "test-session-secret"
  const signed = (body) => `${body}.${crypto.createHmac("sha256", sessionKey).update(body).digest("base64url")}`
  const bodyOf = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  const read = (value) => auth.readSession(fakeRequest({ url: "https://x/api/session", session: value }))

  const live = auth.serializeSession({ userId: "256123", username: "creator" })
  const decoded = JSON.parse(Buffer.from(live.split(".")[0], "base64url").toString("utf8"))
  const loginRes = await testLogin.POST(fakeRequest({ url: "https://x/api/instagram/test-login" }))

  check("S3 a fresh session carries a numeric iat/exp spanning SESSION_TTL_SECONDS", () => {
    assert.equal(decoded.userId, "256123")
    assert.equal(typeof decoded.iat, "number")
    assert.equal(typeof decoded.exp, "number")
    assert.equal(decoded.exp - decoded.iat, auth.SESSION_TTL_SECONDS)
    assert.equal(read(live)?.exp, decoded.exp)
  })
  check("S3b a future exp is accepted and an expired session is rejected", () => {
    assert.ok(read(signed(bodyOf({ userId: "256123", iat: now, exp: now + 3600 }))))
    assert.equal(read(signed(bodyOf({ userId: "256123", iat: now - 7200, exp: now - 60 }))), null)
  })
  check("S3c missing/non-numeric exp and malformed payloads are rejected", () => {
    assert.equal(read(signed(bodyOf({ userId: "256123" }))), null)
    assert.equal(read(signed(bodyOf({ userId: "256123", exp: "soon" }))), null)
    assert.equal(read(signed(Buffer.from("{not json").toString("base64url"))), null)
  })
  check("S3d a well-formed payload with a bad signature is rejected", () => {
    const body = bodyOf({ userId: "256123", exp: now + 3600 })
    assert.equal(read(`${body}.deadbeef`), null)
  })
  check("S3e test-login issues a session with the same lifetime", () => {
    assert.equal(loginRes.status, 200)
    assert.equal(loginRes._cookie?.options?.maxAge, auth.SESSION_TTL_SECONDS)
    assert.equal(read(loginRes._cookie?.value)?.userId, "9999999999")
  })
}

// T. Signature-bypass flag is impossible to arm in production
{
  const prevEnv = process.env.NODE_ENV
  const prevSecret = process.env.SESSION_SECRET
  const prevFlag = process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK
  state.automations = [
    { id: "rule1", user_id: "256123", name: "Price", trigger_source: "dm", trigger_type: "keyword", trigger_value: "price", response_content: { message: "499" }, is_active: true },
  ]
  const raw = delivery("price", "bypass-mid-1")
  const headers = { "x-hub-signature-256": sign(raw, "wrong-secret") }

  // Development: the documented debug flag still works.
  state.sent = 0
  process.env.NODE_ENV = "development"
  process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK = "true"
  const dev = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  const devSent = state.sent

  // Production: the same flag must be ignored and the delivery rejected.
  state.sent = 0
  process.env.NODE_ENV = "production"
  process.env.SESSION_SECRET = "x".repeat(48)
  const prod = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers }))
  const prodSent = state.sent

  process.env.NODE_ENV = prevEnv
  process.env.SESSION_SECRET = prevSecret
  if (prevFlag === undefined) delete process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK
  else process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK = prevFlag

  check("T signature bypass works in dev but is ignored in production", () => {
    assert.equal(dev.status, 200)
    assert.equal(devSent, 1, "dev bypass processes the delivery")
    assert.equal(prod.status, 401, "production must still reject the bad signature")
    assert.equal(prodSent, 0, "production must not process it")
  })
}

// R. CONCURRENCY: two identical deliveries in flight at once -> exactly one reply
{
  state.automations = [
    { id: "rule1", user_id: "256123", name: "Price", trigger_source: "dm", trigger_type: "keyword", trigger_value: "price", response_content: { message: "499" }, is_active: true },
  ]
  state.sent = 0
  const raw = delivery("price", "concurrent-mid-1")
  const headers = { "x-hub-signature-256": sign(raw) }
  await Promise.all([
    cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers })),
    cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers })),
  ])
  check("R two concurrent duplicate deliveries produce exactly one reply", () =>
    assert.equal(state.sent, 1),
  )
}

// R2. CONCURRENCY: comment retries arriving at the same time reply publicly once
{
  state.automations = [
    { id: "comment1", user_id: "256123", name: "Comment rule", trigger_source: "comment", trigger_type: "keyword", trigger_value: "price", response_content: { message: "Sent you a DM!" }, is_active: true },
  ]
  const raw = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ID,
        time: 1,
        changes: [
          {
            field: "comments",
            value: { id: "concurrent-comment-1", text: "price please", from: { id: "ig_commenter" }, media: { id: "media1" }, parent_id: null },
          },
        ],
      },
    ],
  })
  const headers = { "x-hub-signature-256": sign(raw) }
  state.commentReplies = 0
  await Promise.all([
    cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers })),
    cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers })),
  ])
  check("R2 two concurrent duplicate comment deliveries reply publicly once", () =>
    assert.equal(state.commentReplies, 1),
  )
}

// U. Account resolution is ID-based: an unknown account resolves to nothing
{
  state.automations = [
    { id: "rule1", user_id: "256123", name: "Price", trigger_source: "dm", trigger_type: "keyword", trigger_value: "price", response_content: { message: "499" }, is_active: true },
  ]
  state.sent = 0
  const raw = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "999999",
        time: 1,
        messaging: [{ sender: { id: "ig_s" }, recipient: { id: "999999" }, timestamp: 1, message: { mid: "unknown-mid-1", text: "price" } }],
      },
    ],
  })
  const res = await cb.POST(
    fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }),
  )
  check("U an unknown account id resolves to no user and sends no reply", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent, 0)
  })
}

// ============================================================
// Card/Link interactive buttons — full contract regression
// ------------------------------------------------------------
// Covers the exact report: a button added in the editor must survive
// serialization -> API validation -> JSONB -> GET/edit -> preview -> Meta payload.
// ============================================================
const WEB = { type: "web_url", title: "Open Link", url: "https://example.com" }
const PB = { type: "postback", title: "Get It", payload: "SOME_PAYLOAD" }

const cardRule = (buttons) =>
  JSON.stringify({
    userId: "256123",
    name: "Card rule",
    trigger_source: "dm",
    trigger_type: "keyword",
    trigger_value: "guide",
    content: {
      card: { title: "Super", subtitle: "Here is what you wanted", url: "https://hub.docker.com/", buttons },
    },
  })

const postRule = (body) =>
  autos.POST(fakeRequest({ url: "https://x/api/automations", body, session: SESSION }))

// V1. one web_url button survives create
{
  state.automations = []
  const res = await postRule(cardRule([WEB]))
  check("V1 create with one web_url button persists it", () => {
    assert.equal(res.status, 200)
    assert.deepEqual(res._json?.response_content?.card?.buttons, [WEB])
  })
}

// V2. one postback button survives create
{
  state.automations = []
  const res = await postRule(cardRule([PB]))
  check("V2 create with one postback button persists it", () => {
    assert.equal(res.status, 200)
    assert.deepEqual(res._json?.response_content?.card?.buttons, [PB])
  })
}

// V3/V4. two and three buttons survive
{
  state.automations = []
  const two = await postRule(cardRule([WEB, PB]))
  const three = await postRule(cardRule([WEB, PB, { type: "web_url", title: "Third", url: "https://three.example" }]))
  check("V3 two buttons survive create", () => assert.equal(two._json?.response_content?.card?.buttons.length, 2))
  check("V4 three buttons survive create", () => assert.equal(three._json?.response_content?.card?.buttons.length, 3))
}

// V5. four buttons must NOT be silently accepted
{
  state.automations = []
  const res = await postRule(cardRule([WEB, PB, WEB, PB]))
  check("V5 four buttons are rejected and not stored", () => {
    assert.equal(res.status, 400)
    assert.match(res._json.error, /at most 3/i)
    assert.equal(state.automations.length, 0)
  })
}

// V6-V8. incomplete/invalid buttons are rejected with a clear reason
{
  state.automations = []
  const noUrl = await postRule(cardRule([{ type: "web_url", title: "Open Link" }]))
  const noPayload = await postRule(cardRule([{ type: "postback", title: "Get It" }]))
  const noTitle = await postRule(cardRule([{ type: "web_url", title: "   ", url: "https://example.com" }]))
  const badUrl = await postRule(cardRule([{ type: "web_url", title: "Open", url: "notaurl" }]))
  const badType = await postRule(cardRule([{ type: "phone_number", title: "Call" }]))
  check("V6 a web_url button without a URL is rejected", () => assert.equal(noUrl.status, 400))
  check("V7 a postback button without a payload is rejected", () => assert.equal(noPayload.status, 400))
  check("V8 a button without a label is rejected with a clear reason", () => {
    assert.equal(noTitle.status, 400)
    assert.match(noTitle._json.error, /label/i)
  })
  check("V8b a non-http button link is rejected", () => assert.equal(badUrl.status, 400))
  check("V8c an unsupported button type is rejected", () => assert.equal(badType.status, 400))
}

// V9. zero buttons still works
{
  state.automations = []
  const res = await postRule(cardRule([]))
  check("V9 a card with zero buttons still saves", () => {
    assert.equal(res.status, 200)
    assert.deepEqual(res._json?.response_content?.card?.buttons, [])
  })
}

// V10. GET returns the persisted buttons
{
  state.automations = []
  await postRule(cardRule([WEB, PB]))
  const list = await autos.GET(fakeRequest({ url: "https://x/api/automations", query: "userId=256123", session: SESSION }))
  check("V10 GET returns persisted card buttons", () => {
    assert.equal(list.status, 200)
    assert.deepEqual(list._json[0].response_content.card.buttons, [WEB, PB])
  })
}

// V11. PUT preserves/updates buttons (edit -> reload path)
{
  state.automations = []
  const created = await postRule(cardRule([WEB]))
  const expected = [PB, { type: "web_url", title: "Docs", url: "https://docs.example" }]
  const updated = await autos.PUT(fakeRequest({
    url: "https://x/api/automations",
    body: JSON.stringify({
      id: created._json.id,
      name: "Card rule",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "guide",
      content: { card: { title: "Super", subtitle: "Here is what you wanted", url: "https://hub.docker.com/", buttons: expected } },
    }),
    session: SESSION,
  }))
  check("V11 PUT replaces buttons (postback + web_url) and persists them", () => {
    assert.equal(updated.status, 200)
    assert.deepEqual(updated._json.response_content.card.buttons, expected)
  })
  check("V11b the reloaded row still carries the updated buttons", () => {
    assert.deepEqual(state.automations[0].response_content.card.buttons, expected)
  })
}

// V12. PUT with four buttons rejected
{
  state.automations = []
  const created = await postRule(cardRule([WEB]))
  const res = await autos.PUT(fakeRequest({
    url: "https://x/api/automations",
    body: JSON.stringify({
      id: created._json.id,
      name: "Card rule",
      trigger_value: "guide",
      content: { card: { title: "T", buttons: [WEB, WEB, WEB, WEB] } },
    }),
    session: SESSION,
  }))
  check("V12 PUT with four buttons is rejected", () => assert.equal(res.status, 400))
}

// V13. the Meta payload carries the buttons
{
  const att = realIg.buildCardAttachment({
    title: "Super",
    subtitle: "Here is what you wanted",
    image_url: "https://example.com/cover.png",
    url: "https://hub.docker.com/",
    buttons: [WEB, PB],
  })
  const el = att.attachment.payload.elements[0]
  check("V13 the generic template carries both buttons verbatim", () => {
    assert.deepEqual(el.buttons, [WEB, PB])
    assert.equal(el.default_action.url, "https://hub.docker.com/")
  })
  const three = realIg.buildCardAttachment({ title: "T", buttons: [WEB, PB, { type: "web_url", title: "3", url: "https://3.example" }] })
  const guarded = realIg.buildCardAttachment({ title: "T", buttons: [WEB, { type: "web_url", title: "No url" }] })
  check("V13b three buttons are sent; the wire guard still drops an invalid one", () => {
    assert.equal(three.attachment.payload.elements[0].buttons.length, 3)
    assert.equal(guarded.attachment.payload.elements[0].buttons.length, 1)
  })
}

// V14. preview renders 0..3 buttons and flags an unlabelled one
{
  const labels = (list) => list.map((b, i) => cardLib.cardButtonPreviewLabel(b, i))
  check("V14 preview shows 0/1/2/3 buttons and flags one without a label", () => {
    assert.equal(labels([]).length, 0)
    assert.deepEqual(labels([WEB]), [{ text: "Open Link", complete: true }])
    assert.equal(labels([WEB, PB]).length, 2)
    assert.equal(labels([WEB, PB, WEB]).length, 3)
    assert.deepEqual(labels([{ type: "web_url", title: "", url: "" }]), [
      { text: "Button 1 — add a label", complete: false },
    ])
  })
}

// V15. serialize + validate agree with the sender's rules
{
  const out = cardLib.serializeCardButtons([
    { type: "web_url", title: "  Open  ", url: "  https://example.com  ", payload: "ignored" },
    { type: "postback", title: "Go", payload: "  PAY  ", url: "ignored" },
  ])
  check("V15 serialize trims and keeps exactly the fields each button type uses", () => {
    assert.deepEqual(out, [
      { type: "web_url", title: "Open", url: "https://example.com" },
      { type: "postback", title: "Go", payload: "PAY" },
    ])
  })
  check("V15b validator accepts valid/absent buttons and rejects 4", () => {
    assert.equal(cardLib.validateCardButtons([WEB, PB]), null)
    assert.equal(cardLib.validateCardButtons([]), null)
    assert.equal(cardLib.validateCardButtons(undefined), null)
    assert.match(cardLib.validateCardButtons([WEB, WEB, WEB, WEB]), /at most 3/i)
  })
}


// ============================================================
// FOLLOW GATE — three-state result: FOLLOWS / DOES_NOT_FOLLOW / UNKNOWN
// A commenter with no messaging consent gets Meta code 230; that must map to
// UNKNOWN (never a false "does not follow", never an HTTP 500).
// ============================================================
function commentDelivery(text, { commentId = "c_follow", from = "ig_commenter", media = "media_follow", parentId = null } = {}) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ID,
        time: 1,
        changes: [
          { field: "comments", value: { id: commentId, text, from: { id: from }, media: { id: media }, parent_id: parentId } },
        ],
      },
    ],
  })
}

function stubFollowResponse(payload) {
  global.fetch = async () => ({ ok: true, json: async () => payload })
}

function stubConsentError() {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () =>
      JSON.stringify({
        error: {
          message: "User consent is required to access user profile",
          type: "IGApiException",
          code: 230,
          fbtrace_id: "trace",
        },
      }),
  })
}

const commentGateRule = () => [
  {
    id: "gate1",
    user_id: "256123",
    name: "Comment gate",
    trigger_source: "comment",
    trigger_type: "keyword",
    trigger_value: "link",
    response_content: { message: "Here is your link", check_follow: true },
    is_active: true,
  },
]

// W1. Instagram explicitly says the user follows -> deliver content.
{
  state.automations = commentGateRule()
  state.sent = 0
  state.cardSent = 0
  state.commentReplies = 0
  const raw = commentDelivery("link", { commentId: "c_follows" })
  stubFollowResponse({ is_user_follow_business: true })
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W1 comment gate FOLLOWS -> content delivered, no gate card", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent, 1)
    assert.equal(state.cardSent, 0)
  })
}

// W2. Instagram explicitly says the user does not follow -> gate card only.
{
  state.automations = commentGateRule()
  state.sent = 0
  state.cardSent = 0
  const raw = commentDelivery("link", { commentId: "c_notfollow" })
  stubFollowResponse({ is_user_follow_business: false })
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W2 comment gate DOES_NOT_FOLLOW -> gate card, no content", () => {
    assert.equal(res.status, 200)
    assert.equal(state.cardSent, 1)
    assert.equal(state.sent, 0)
  })
}

// W3. Meta code 230 (commenter has no messaging consent) -> UNKNOWN, never a 500
// and never the "you don't follow us" gate. The flow continues (fails open).
{
  state.automations = commentGateRule()
  state.sent = 0
  state.cardSent = 0
  const raw = commentDelivery("link", { commentId: "c_consent" })
  stubConsentError()
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W3 code 230 -> UNKNOWN: HTTP 200, content delivered, no false not-following gate", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent, 1, "content must still be delivered")
    assert.equal(state.cardSent, 0, "must not send the doesn't-follow gate card")
  })
}

// W4. HTTP 200 with no boolean field is inconclusive -> UNKNOWN, not DOES_NOT_FOLLOW.
{
  state.automations = commentGateRule()
  state.sent = 0
  state.cardSent = 0
  const raw = commentDelivery("link", { commentId: "c_malformed" })
  stubFollowResponse({})
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W4 200 without is_user_follow_business -> UNKNOWN, not a false not-following", () => {
    assert.equal(state.cardSent, 0)
    assert.equal(state.sent, 1)
  })
}

// W5. check_follow disabled -> no follow-status API call at all.
{
  state.automations = [
    {
      ...commentGateRule()[0],
      id: "nogate",
      response_content: { message: "Open content", check_follow: false },
    },
  ]
  state.sent = 0
  state.cardSent = 0
  let fetchCalls = 0
  global.fetch = async () => {
    fetchCalls++
    return { ok: true, json: async () => ({}) }
  }
  const raw = commentDelivery("link", { commentId: "c_nogate" })
  await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W5 check_follow disabled -> no follow-status API call", () => {
    assert.equal(fetchCalls, 0)
    assert.equal(state.sent, 1)
  })
}

// W6. User with an established DM context (Situation B) -> FOLLOWS delivers content.
{
  state.automations = [
    {
      id: "dmgate",
      user_id: "256123",
      name: "DM gate",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "vip",
      response_content: { message: "VIP content", check_follow: true },
      is_active: true,
    },
  ]
  state.sent = 0
  state.cardSent = 0
  const raw = delivery("vip", "m_follow_dm")
  stubFollowResponse({ is_user_follow_business: true })
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W6 DM gate FOLLOWS -> content delivered", () => {
    assert.equal(res.status, 200)
    assert.equal(state.sent, 1)
    assert.equal(state.cardSent, 0)
  })
}

// W7. DM gate consent error -> UNKNOWN fail-open, no gate card, HTTP 200.
{
  state.sent = 0
  state.cardSent = 0
  const raw = delivery("vip", "m_consent_dm")
  stubConsentError()
  const res = await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  check("W7 DM gate code 230 -> UNKNOWN: HTTP 200, no gate card", () => {
    assert.equal(res.status, 200)
    assert.equal(state.cardSent, 0)
    assert.equal(state.sent, 1)
  })
}

// ============================================================
// MEDIA FETCH — normalized /me/media errors + safe logging
// ============================================================
const mediaReq = () =>
  fakeRequest({ url: "https://x/api/instagram/media?userId=256123", session: SESSION })

function stubMediaFetch(response) {
  global.fetch = async () => response
}

// M1. success -> image_url normalized from media_url/thumbnail_url
{
  stubMediaFetch({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "m1", media_type: "IMAGE", media_url: "https://cdn/img.jpg" }] }),
  })
  const res = await media.GET(mediaReq())
  check("M1 media success -> image_url normalized", () => {
    assert.equal(res.status, 200)
    assert.equal(res._json.data[0].image_url, "https://cdn/img.jpg")
  })
}

// M2. code 200 "API access blocked" -> clear normalized error, not opaque 500,
// and does NOT tell the user to reconnect (the token is not the problem).
{
  stubMediaFetch({
    ok: false,
    status: 400,
    headers: new Headers({ "www-authenticate": 'OAuth "Facebook Platform" "access_denied" "API access blocked."' }),
    json: async () => ({
      error: {
        message: "API access blocked.",
        type: "OAuthException",
        code: 200,
        error_subcode: 458,
        fbtrace_id: "trace-media",
      },
    }),
  })
  const res = await media.GET(mediaReq())
  check("M2 code 200 access blocked -> INSTAGRAM_MEDIA_ACCESS_BLOCKED, no reauth prompt", () => {
    assert.equal(res.status, 403)
    assert.equal(res._json.normalized.type, "INSTAGRAM_MEDIA_ACCESS_BLOCKED")
    assert.equal(res._json.normalized.retryable, false)
    assert.equal(res._json.normalized.requiresReauthorization, false)
    assert.equal(res._json.normalized.subcode, 458)
  })
}

// M3. code 190 (expired token) -> 401 and reauthorization IS required
{
  stubMediaFetch({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "Session has expired", type: "OAuthException", code: 190, fbtrace_id: "t" } }),
  })
  const res = await media.GET(mediaReq())
  check("M3 code 190 -> INSTAGRAM_MEDIA_SESSION_EXPIRED, reauth required, 401", () => {
    assert.equal(res.status, 401)
    assert.equal(res._json.normalized.type, "INSTAGRAM_MEDIA_SESSION_EXPIRED")
    assert.equal(res._json.normalized.requiresReauthorization, true)
  })
}

// M4. a non-JSON error body must not crash into an opaque failure
{
  stubMediaFetch({
    ok: false,
    status: 400,
    json: async () => {
      throw new Error("not json")
    },
  })
  const res = await media.GET(mediaReq())
  check("M4 non-JSON error body -> normalized error, no crash", () => {
    assert.equal(res.status, 500)
    assert.equal(res._json.normalized.type, "INSTAGRAM_MEDIA_ERROR")
  })
}

// M5. the access token never reaches the logs
{
  const originalToken = state.user.access_token
  state.user.access_token = "SECRET_TOKEN_XYZ"
  const logs = []
  const origLog = console.log
  const origErr = console.error
  const capture = (...args) =>
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  console.log = capture
  console.error = capture
  try {
    stubMediaFetch({
      ok: false,
      status: 400,
      headers: new Headers({ "www-authenticate": "OAuth access_denied" }),
      json: async () => ({ error: { message: "API access blocked.", type: "OAuthException", code: 200, fbtrace_id: "t" } }),
    })
    await media.GET(mediaReq())
  } finally {
    console.log = origLog
    console.error = origErr
    state.user.access_token = originalToken
  }
  check("M5 media logs never contain the access token", () => {
    assert.ok(logs.length > 0, "the route must log diagnostics")
    assert.ok(!logs.some((l) => l.includes("SECRET_TOKEN_XYZ")), "token must never be logged")
  })
}
// X. Ice breakers: correct Meta payload shape, DELETE on empty, and honest
// reporting when Meta rejects the sync.
{
  const prevFetch = global.fetch
  const requests = []
  let reply = { ok: true, status: 200, json: async () => ({ success: true }) }
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null })
    return reply
  }

  const ibPost = (body) =>
    iceBreakers.POST(fakeRequest({ url: "https://x/api/ice-breakers", body: JSON.stringify(body), session: SESSION }))

  state.iceBreakers = []
  const saved = await ibPost({
    userId: "256123",
    iceBreakers: [
      { question: "What are your prices?", response: "Starts at $10" },
      { question: "What are your hours?", response: "9am-5pm" },
    ],
  })
  const createRequest = requests[0]

  const tooMany = await ibPost({
    userId: "256123",
    iceBreakers: Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, response: "r" })),
  })
  const blank = await ibPost({ userId: "256123", iceBreakers: [{ question: "   ", response: "r" }] })
  const tooLong = await ibPost({ userId: "256123", iceBreakers: [{ question: "x".repeat(81), response: "r" }] })

  state.iceBreakers = [{ id: "ib_old", user_id: "256123", question: "old", response: "old" }]
  requests.length = 0
  const cleared = await ibPost({ userId: "256123", iceBreakers: [] })
  const clearRequest = requests[0]

  reply = { ok: false, status: 400, json: async () => ({ error: { type: "OAuthException", code: 190, message: "bad token" } }) }
  const rejected = await ibPost({ userId: "256123", iceBreakers: [{ question: "Hi", response: "Hello" }] })

  global.fetch = prevFetch
  state.iceBreakers = []

  check("X ice breakers are POSTed as ice_breakers[0].call_to_actions", () => {
    assert.equal(saved.status, 200)
    assert.equal(createRequest.method, "POST")
    assert.match(createRequest.url, /\/me\/messenger_profile\?access_token=/)
    assert.equal(createRequest.body.platform, "instagram")
    assert.equal(createRequest.body.ice_breakers.length, 1)
    assert.equal(createRequest.body.ice_breakers[0].call_to_actions.length, 2)
    assert.equal(createRequest.body.ice_breakers[0].call_to_actions[0].question, "What are your prices?")
    assert.ok(createRequest.body.ice_breakers[0].call_to_actions[0].payload.startsWith("ICE_BREAKER_"))
  })
  check("X2 removing every ice breaker DELETEs the ice_breakers field", () => {
    assert.equal(cleared.status, 200)
    assert.equal(clearRequest.method, "DELETE")
    assert.deepEqual(clearRequest.body, { fields: ["ice_breakers"] })
    assert.equal(state.iceBreakers.filter((row) => row.user_id === "256123").length, 0)
  })
  check("X3 invalid entries are rejected before any Meta call", () => {
    assert.equal(tooMany.status, 400)
    assert.equal(blank.status, 400)
    assert.equal(tooLong.status, 400)
  })
  check("X4 a Meta rejection is reported as a sync failure, never a fake success", () => {
    assert.equal(rejected.status, 502)
    assert.equal(rejected._json.savedLocally, true)
  })
}

// M5. The access token must never reach any console channel, even when a network
// error embeds the full token-bearing URL in its message.
{
  const channels = ["log", "error", "warn", "info"]
  const originals = {}
  const captured = []
  const prevFetch = global.fetch
  const prevToken = state.user.access_token
  const prevAutomations = state.automations
  const secret = "IGsecretToken_abcdef1234567890"

  state.user.access_token = secret
  state.automations = [
    {
      id: "gate1",
      user_id: "256123",
      name: "Gate rule",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "secret",
      response_content: { check_follow: true, message: "hi" },
      is_active: true,
    },
  ]

  try {
    for (const channel of channels) {
      originals[channel] = console[channel]
      console[channel] = (...args) => {
        captured.push(
          args
            .map((arg) =>
              typeof arg === "string"
                ? arg
                : arg instanceof Error
                  ? `${arg.name}: ${arg.message} ${arg.cause ?? ""}`
                  : JSON.stringify(arg),
            )
            .join(" "),
        )
      }
    }
    // Worst case: the transport fails with an error whose message is the URL.
    global.fetch = async (url) => {
      throw new Error(`network failure for ${url}`)
    }
    const raw = delivery("secret", "leak-mid-1")
    await cb.POST(fakeRequest({ url: "https://x/api/instagram/callback", body: raw, headers: { "x-hub-signature-256": sign(raw) } }))
  } finally {
    for (const channel of channels) console[channel] = originals[channel]
    global.fetch = prevFetch
    state.user.access_token = prevToken
    state.automations = prevAutomations
    state.sent = 0
  }

  check("M5 the access token is never logged through log/error/warn/info", () => {
    const output = captured.join("\n")
    assert.ok(captured.length > 0, "expected console output to scan")
    assert.equal(output.includes(secret), false, "access token must never be logged")

  })
}

console.log(results.join("\n"))
const failed = results.filter((r) => r.startsWith("FAIL"))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
