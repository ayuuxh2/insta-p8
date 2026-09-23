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
      user_id: "256123",
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
  commentReplies: 0,
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
    this.cookies = {
      set: (name, value, options) => {
        this._cookie = { name, value, options }
      },
      get() {
        return undefined
      },
      delete() {},
    }
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
//
// The harness emulates the database's UNIQUE constraints *synchronously inside
// insert()*, because that is the property the production fix relies on. A real
// Postgres unique index serialises concurrent inserts on the indexed value; a
// check performed later (e.g. in `then`) would leave the same race the old
// SELECT-then-INSERT code had, and the concurrency test would pass vacuously.
function makeDb() {
  function from(table) {
    // Result of this query builder only — scoped per from() so concurrent
    // queries (the webhook runs inbox bookkeeping alongside delivery) cannot
    // read each other's pending insert/update.
    let pending = null
    const eqs = []
    const containsArgs = []
    const orArgs = []
    const match = (row) => eqs.every(([column, value]) => String(row[column]) === String(value))
    const containsMatch = (row) =>
      containsArgs.every(([column, value]) =>
        Object.entries(value).every(([key, expected]) => String(row?.[column]?.[key]) === String(expected)),
      )
    const duplicateKey = { code: "23505", message: "duplicate key value violates unique constraint" }
    const q = {
      select() { return q },
      eq(column, value) { eqs.push([column, value]); return q },
      contains(column, value) { containsArgs.push([column, value]); return q },
      or(expr) { orArgs.push(expr); return q },
      limit() { return q },
      order() { return q },
      update(row) {
        if (table === "automations") {
          const target = state.automations.find(match)
          if (target) Object.assign(target, row)
          pending = { data: target || null, error: null }
          return q
        }
        pending = { data: null, error: null }
        return q
      },
      insert(row) {
        if (table === "automations") {
          const saved = { id: row.id || `auto_${state.automations.length + 1}`, is_active: true, ...row }
          state.automations.push(saved)
          pending = { data: saved, error: null }
          return q
        }
        if (table === "webhook_events" && row?.event_key) {
          if (state.audit.some((r) => r.event_key === row.event_key)) {
            pending = { data: null, error: duplicateKey }
            return q
          }
        }
        if (table === "messages" && row?.id) {
          if (state.saved.some((r) => r.id === row.id)) {
            pending = { data: null, error: duplicateKey }
            return q
          }
        }
        if (table === "messages") state.saved.push(row)
        if (table === "webhook_events") state.audit.push(row)
        pending = { data: null, error: null }
        return q
      },
      upsert(row) { state.upserts.push(row); return Promise.resolve({ error: null }) },
      single() {
        if (pending) {
          const p = pending
          pending = null
          return Promise.resolve(p)
        }
        if (table === "users") {
          // Honour `.or(business_account_id.eq.X,page_id.eq.X)` so account
          // resolution is genuinely ID-based (a foreign ID must not resolve).
          if (orArgs.length) {
            const ok = orArgs.some((expr) =>
              expr.split(",").some((clause) => {
                const m = /^([\w.]+?)\.eq\.(.*)$/.exec(clause.trim())
                if (!m) return true
                return String(state.user[m[1]]) === String(m[2])
              }),
            )
            return Promise.resolve({ data: ok ? state.user : null, error: null })
          }
          return Promise.resolve({ data: state.user, error: null })
        }
        if (table === "conversations") return Promise.resolve({ data: { id: "conv1" }, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle() {
        if (table === "automations") {
          const row = state.automations.find(match)
          return Promise.resolve({ data: row ? { user_id: row.user_id } : null, error: null })
        }
        if (table === "conversations") return Promise.resolve({ data: { user_id: state.user.id }, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      then(resolve, reject) {
        if (pending) {
          const p = pending
          pending = null
          return Promise.resolve(p).then(resolve, reject)
        }
        let data = null
        if (table === "automations") data = state.automations
        if (table === "messages") data = state.saved.filter(match)
        if (table === "webhook_events") data = state.audit.filter((row) => match(row) && containsMatch(row))
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
export async function replyToComment() {
  state.commentReplies++
  return { ok: true }
}
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
