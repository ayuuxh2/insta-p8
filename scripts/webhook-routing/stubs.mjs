// Stubs for every dependency the Instagram callback + webhook routes import.
// All stubbed specifiers resolve to this single module (see loader.mjs), so the
// shared `state` object is the one the routes actually mutate.

export const state = {
  user: {
    id: "256123",
    username: "creator",
    access_token: "tok",
    business_account_id: "17841400000000000",
    page_id: "17841400000000000",
    groq_auto_reply_enabled: false,
    ai_context: "",
  },
  automations: [
    {
      id: "rule1",
      name: "Price rule",
      trigger_source: "dm",
      trigger_type: "keyword",
      trigger_value: "price",
      response_content: { message: "499" },
      is_active: true,
    },
  ],
  sent: 0,
  lastSend: null,
  cardSent: 0,
  lastCard: null,
  lastMedia: null,
  failCardTemplate: false,
  saved: [],
  audit: [],
  upserts: [],
}

// ---------- next/server ----------
export class NextResponse {
  constructor(body, init = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.headers = new Headers(init.headers)
    this.cookies = { set() {}, get() { return undefined }, delete() {} }
  }
  static json(data, init = {}) {
    const res = new NextResponse(JSON.stringify(data), init)
    res._json = data
    return res
  }
  static redirect(url, status = 307) {
    return { __redirect: String(url), status, headers: new Headers() }
  }
}

export class NextRequest {
  constructor(input, init = {}) {
    this.url = typeof input === "string" ? input : input?.url ?? String(input)
    this.method = init.method ?? "GET"
    this.headers = new Headers(init.headers)
    this._body = init.body
  }
  async text() {
    return typeof this._body === "string" ? this._body : ""
  }
  get nextUrl() {
    return { searchParams: new URL(this.url).searchParams }
  }
}

// ---------- @/lib/supabase-server ----------
function makeDb() {
  let inserted = null
  function from(table) {
    const q = {
      select() { return q },
      eq() { return q },
      or() { return q },
      update(row) { inserted = row; return q },
      insert(row) { inserted = row; return q },
      upsert(row) { state.upserts.push(row); return Promise.resolve({ error: null }) },
      single() {
        return Promise.resolve({
          data: table === "users" ? state.user : table === "conversations" ? { id: "conv1" } : null,
          error: null,
        })
      },
      then(resolve, reject) {
        let data = null
        if (table === "automations") data = state.automations
        if (table === "messages" && inserted) { state.saved.push(inserted); inserted = null }
        if (table === "webhook_events" && inserted) { state.audit.push(inserted); inserted = null }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { from }
}

export async function getSupabaseServerClient() {
  return makeDb()
}

// ---------- @/lib/supabase-migrate ----------
export async function ensureSchema() {}

// ---------- @/lib/ai-reply ----------
export async function generateAIReply() {
  return null
}

// ---------- @/lib/instagram-api ----------
export async function sendTextDM(token, recipient, text) {
  state.sent++
  state.lastSend = { recipient, text }
  return { ok: true, id: "msg_out" }
}
export async function sendCardDM(token, recipient, card) {
  state.cardSent++
  state.lastCard = card
  if (state.failCardTemplate) return { ok: false, error: { code: 100, message: "image_url could not be fetched" } }
  return { ok: true }
}
export async function sendMediaDM(token, recipient, type, url) {
  state.sent++
  state.lastMedia = { type, url }
  return { ok: true }
}
export async function sendSenderAction() { return { ok: true } }
export async function replyToComment() { return { ok: true } }
export async function fetchProfile() { return { username: "sender" } }
export async function verifyIdOwnership() { return false }
export function sleep() { return Promise.resolve() }
export function buildFollowGateCard() { return { title: "gate", buttons: [] } }

// Reuse the real URL helpers so this stub can never drift from production behaviour.
export { isHttpUrl, validateImageUrl } from "../../lib/instagram-api.ts"

// ---------- @/lib/unlock-tracking ----------
export function unlockKey(senderId, ruleId) { return `${senderId}::${ruleId}` }
export async function bumpUnlockAttempt() { return 1 }
export async function clearUnlockAttempts() {}
