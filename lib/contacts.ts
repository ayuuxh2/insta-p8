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

export async function setUsernameIfMissing(db: Db, userId: number | string, igId: string, username?: string | null) {
  if (!username || username.startsWith("cnt_")) return
  await db.from("contacts").update({ username }).eq("user_id", userId).eq("ig_id", igId).is("username", null)
}
