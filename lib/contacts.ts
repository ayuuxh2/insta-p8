// Contact history helpers (tables: migrations/004_etapa4_contatos.sql).

type Db = any

export type ContactEvent =
  | "comment"
  | "dm"
  | "story"
  | "optin_sent"
  | "optin_tap"
  | "unlock_tap"
  | "gate_sent"
  | "content_sent"
  | "opt_out"
  | "opt_in"
  | "link_click"

// Events that represent the person doing something (they update "last interaction").
const TRIGGER_EVENTS = new Set<ContactEvent>(["comment", "dm", "story", "optin_tap", "unlock_tap", "opt_out", "opt_in", "link_click"])

export async function recordEvent(
  db: Db,
  userId: number | string,
  igId: string,
  event: ContactEvent,
  details: { automationId?: string | null; keyword?: string | null; mediaId?: string | null } = {},
) {
  const automationId = details.automationId && /^[0-9a-f-]{36}$/i.test(details.automationId) ? details.automationId : null
  const { error } = await db.from("contact_events").insert({
    user_id: userId,
    ig_id: igId,
    event,
    automation_id: automationId,
    keyword: details.keyword || null,
    media_id: details.mediaId || null,
  })
  if (error) console.error("[contacts] recordEvent failed:", error.message)

  if (TRIGGER_EVENTS.has(event)) {
    const update: any = { last_event: event, last_seen_at: new Date().toISOString() }
    if (details.keyword) update.last_keyword = details.keyword
    if (automationId) update.last_automation_id = automationId
    const { error: e } = await db.from("contacts").update(update).eq("user_id", userId).eq("ig_id", igId)
    if (e) console.error("[contacts] update last interaction failed:", e.message)
  }
}

export async function setFollows(db: Db, userId: number | string, igId: string, follows: boolean) {
  const { error } = await db
    .from("contacts")
    .update({ follows, follows_checked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("ig_id", igId)
  if (error) console.error("[contacts] setFollows failed:", error.message)
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40)).filter(Boolean))]
}

export async function addTags(db: Db, userId: number | string, igId: string, tags: unknown) {
  const clean = normalizeTags(tags)
  if (!clean.length) return
  const { error } = await db.rpc("add_contact_tags", { p_user_id: userId, p_ig_id: igId, p_tags: clean })
  if (error) console.error("[contacts] addTags failed:", error.message)
}

export const DELETE_CONFIRMATION =
  "Pronto! Apagamos os seus dados da nossa ferramenta de respostas automáticas (contato, histórico e mensagens registradas). 🗑️"

/** "excluir meus dados" / "apagar meus dados" (whole message, accents and case ignored). */
export function isDeleteRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[!.\s]+$/g, "").replace(/\s+/g, " ")
  return ["excluir meus dados", "apagar meus dados", "deletar meus dados", "remover meus dados"].includes(normalized)
}

/**
 * LGPD erasure: removes every record about one person (contact, history, links, inbox,
 * queued replies, unlock counters). Instagram itself keeps the DM thread on its side.
 */
export async function deleteContactData(db: Db, userId: number | string, igId: string) {
  const steps: Array<[string, () => Promise<{ error: any }>]> = [
    ["contact_events", () => db.from("contact_events").delete().eq("user_id", userId).eq("ig_id", igId)],
    ["tracked_links", () => db.from("tracked_links").delete().eq("user_id", userId).eq("ig_id", igId)],
    ["pending_replies", () => db.from("pending_replies").delete().eq("user_id", userId).eq("sender_id", igId)],
    ["unlock_attempts", () => db.from("unlock_attempts").delete().like("key", `${igId}::%`)],
    ["contacts", () => db.from("contacts").delete().eq("user_id", userId).eq("ig_id", igId)],
  ]
  const { data: conv } = await db.from("conversations").select("id").eq("user_id", userId).eq("recipient_id", igId).maybeSingle()
  if (conv) {
    steps.push(["messages", () => db.from("messages").delete().eq("conversation_id", conv.id)])
    steps.push(["conversations", () => db.from("conversations").delete().eq("id", conv.id)])
  }
  for (const [table, run] of steps) {
    const { error } = await run()
    if (error) console.error(`[contacts] delete ${table} failed:`, error.message)
  }
  // Webhook log rows carry the sender id in data.ig (data.de may be the @username).
  await db.from("webhook_events").delete().eq("user_id", userId).eq("data->>ig", igId)
  await db.from("webhook_events").delete().eq("user_id", userId).eq("data->>de", igId)
}

export async function setUsernameIfMissing(db: Db, userId: number | string, igId: string, username?: string | null) {
  if (!username || username.startsWith("cnt_")) return
  await db.from("contacts").update({ username }).eq("user_id", userId).eq("ig_id", igId).is("username", null)
}
