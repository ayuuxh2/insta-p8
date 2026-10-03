// Anti-spam helpers for the webhook: idempotency, hourly send limits, contacts/opt-out,
// human-like delays and message variations. Tables: migrations/003_etapa3_antispam.sql.

type Db = any

// Instagram allows 750 private replies per hour per account; keep a safety margin.
export const PRIVATE_REPLY_HOURLY_LIMIT = 700

export const OPT_OUT_WORDS = ["sair", "parar", "stop", "cancelar", "descadastrar"]
export const OPT_IN_WORDS = ["voltar"]

export const OPT_OUT_CONFIRMATION =
  "Pronto! Você não vai mais receber mensagens automáticas da gente. Se quiser voltar, é só mandar VOLTAR. 👋"
export const OPT_IN_CONFIRMATION = "Que bom te ver de volta! Você voltou a receber nossas mensagens automáticas. 😊"

/**
 * Claims a webhook event so it is handled once. Returns false if it was already handled
 * (Meta retries deliveries). On unexpected DB errors we still return true: a rare duplicate
 * is better than silently dropping a customer's message.
 */
export async function claimEvent(db: Db, key: string): Promise<boolean> {
  const { error } = await db.from("processed_events").insert({ event_key: key })
  if (!error) return true
  if (error.code === "23505") return false
  console.error("[antispam] claimEvent failed:", error.message)
  return true
}

export async function logSend(db: Db, userId: number | string, kind: "private_reply" | "dm" | "public_reply") {
  const { error } = await db.from("send_log").insert({ user_id: userId, kind })
  if (error) console.error("[antispam] logSend failed:", error.message)
}

export async function countSendsLastHour(db: Db, userId: number | string, kind: string): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count, error } = await db
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since)
  if (error) {
    console.error("[antispam] countSendsLastHour failed:", error.message)
    return 0
  }
  return count || 0
}

/** Records the interaction and returns whether this person opted out of automated messages. */
export async function touchContact(db: Db, userId: number | string, igId: string, username?: string | null): Promise<{ optedOut: boolean }> {
  const now = new Date().toISOString()
  const row: any = { user_id: userId, ig_id: igId, last_seen_at: now }
  if (username) row.username = username
  const { data, error } = await db
    .from("contacts")
    .upsert(row, { onConflict: "user_id,ig_id" })
    .select("opted_out")
    .single()
  if (error) {
    console.error("[antispam] touchContact failed:", error.message)
    return { optedOut: false }
  }
  return { optedOut: data?.opted_out === true }
}

export async function setOptOut(db: Db, userId: number | string, igId: string, optedOut: boolean) {
  const { error } = await db
    .from("contacts")
    .upsert(
      { user_id: userId, ig_id: igId, opted_out: optedOut, opted_out_at: optedOut ? new Date().toISOString() : null, last_seen_at: new Date().toISOString() },
      { onConflict: "user_id,ig_id" },
    )
  if (error) console.error("[antispam] setOptOut failed:", error.message)
}

/** "sair" / "voltar" style commands, matched on the whole message only. */
export function optCommand(text: string): "out" | "in" | null {
  const normalized = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[!.\s]+$/g, "")
  if (OPT_OUT_WORDS.includes(normalized)) return "out"
  if (OPT_IN_WORDS.includes(normalized)) return "in"
  return null
}

/** Picks the main message or one of its variations, so repeated sends are not identical. */
export function pickMessage(content: any): string {
  const options = [content?.message, ...(Array.isArray(content?.message_variants) ? content.message_variants : [])]
    .map((m: any) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean)
  return options.length ? options[Math.floor(Math.random() * options.length)] : ""
}

/** Configured delay plus 1.5–4.5 s of random jitter, capped at 30 s. */
export function humanDelayMs(content: any): number {
  const base = Math.max(0, Number(content?.delay_seconds) || 0) * 1000
  const jitter = 1500 + Math.random() * 3000
  return Math.min(base + jitter, 30_000)
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
