// Conversation flows in steps (e.g. RAIOX): one question at a time, answers kept in lead_flows.
// The rule's response_content carries the flow:
//   { direct_send: true, message: "<first question>",
//     flow: { id: "raiox", followups: ["<question 2>", "<question 3>"], done_message: "...", validate_first: "contact",
//             retry_message: "...", done_tag: "raiox-pedido", notify: true, notify_title: "Novo pedido de Raio-X" } }
// The first message is sent by the normal rule path (comment private reply or DM); this file only keeps the state.

type Db = any

export type FlowConfig = {
  id: string
  followups: string[]
  done_message: string
  validate_first?: "contact"
  retry_message?: string
  done_tag?: string
  notify?: boolean
  notify_title?: string
  labels?: string[]
}

export type FlowRow = {
  id: string
  user_id: number
  ig_id: string
  username: string | null
  automation_id: string | null
  flow: string
  step: number
  status: "coletando" | "pedido" | "analisando" | "entregue" | "falhou" | "cancelado"
  answers: { step: number; text: string; at: string }[]
  invalid_tries: number
  attempts: number
  last_error: string | null
  result_path: string | null
  result_cover_path: string | null
  started_at: string
  last_inbound_at: string | null
  requested_at: string | null
}

const DAY = 86_400_000
/** An unanswered flow is abandoned after this long (the private reply window is 7 days). */
export const FLOW_OPEN_DAYS = 7

export function flowOf(content: any): FlowConfig | null {
  const f = content?.flow
  if (!f || typeof f !== "object" || !f.id || !f.done_message) return null
  return {
    id: String(f.id),
    followups: Array.isArray(f.followups) ? f.followups.map(String).filter(Boolean) : [],
    done_message: String(f.done_message),
    validate_first: f.validate_first === "contact" ? "contact" : undefined,
    retry_message: f.retry_message ? String(f.retry_message) : undefined,
    done_tag: f.done_tag ? String(f.done_tag) : undefined,
    notify: f.notify !== false,
    notify_title: f.notify_title ? String(f.notify_title) : undefined,
    labels: Array.isArray(f.labels) ? f.labels.map(String) : undefined,
  }
}

/** An Instagram @, an Instagram link or something that looks like a website address. */
export function looksLikeContact(text: string): boolean {
  const t = String(text || "").trim()
  if (/@[a-z0-9._]{2,30}/i.test(t)) return true
  if (/(https?:\/\/|www\.)\S+/i.test(t)) return true
  if (/\b[a-z0-9-]{2,}\.(com|com\.br|net|org|br|app|site|shop|store|online|digital|adv\.br|med\.br)\b/i.test(t)) return true
  // A single word that is a plausible handle (no spaces, letters/digits/._), e.g. "minhaloja"
  return /^[a-z0-9._]{3,30}$/i.test(t)
}

export async function getOpenFlow(db: Db, userId: number | string, igId: string): Promise<FlowRow | null> {
  const { data } = await db
    .from("lead_flows")
    .select("*")
    .eq("user_id", userId)
    .eq("ig_id", igId)
    .eq("status", "coletando")
    .order("started_at", { ascending: false })
    .limit(1)
  const row = (data || [])[0] as FlowRow | undefined
  if (!row) return null
  if (Date.now() - new Date(row.started_at).getTime() > FLOW_OPEN_DAYS * DAY) {
    await db.from("lead_flows").update({ status: "cancelado", updated_at: new Date().toISOString() }).eq("id", row.id)
    return null
  }
  return row
}

/** Status of this person's flow of this type if one is in progress or finished within the last 7 days, else null. */
export async function recentFlowStatus(db: Db, userId: number | string, igId: string, flow: string): Promise<FlowRow["status"] | null> {
  const since = new Date(Date.now() - FLOW_OPEN_DAYS * DAY).toISOString()
  const { data } = await db
    .from("lead_flows")
    .select("status, started_at")
    .eq("user_id", userId)
    .eq("ig_id", igId)
    .eq("flow", flow)
    .gte("started_at", since)
    .in("status", ["coletando", "pedido", "analisando", "entregue"])
    .order("started_at", { ascending: false })
    .limit(1)
  return (data && data[0]?.status) || null
}

export async function startFlow(db: Db, userId: number | string, igId: string, flow: string, automationId: string | null, username?: string | null) {
  const now = new Date().toISOString()
  await db
    .from("lead_flows")
    .update({ status: "cancelado", updated_at: now })
    .eq("user_id", userId)
    .eq("ig_id", igId)
    .eq("flow", flow)
    .in("status", ["coletando"])
  const { error } = await db.from("lead_flows").insert({
    user_id: userId,
    ig_id: igId,
    username: username || null,
    automation_id: automationId,
    flow,
    step: 1,
    status: "coletando",
    answers: [],
    started_at: now,
    updated_at: now,
  })
  if (error) console.error("[flows] startFlow failed:", error.message)
}

export async function cancelOpenFlows(db: Db, userId: number | string, igId: string) {
  await db
    .from("lead_flows")
    .update({ status: "cancelado", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("ig_id", igId)
    .in("status", ["coletando"])
}

export async function bumpInvalid(db: Db, row: FlowRow) {
  await db.from("lead_flows").update({ invalid_tries: row.invalid_tries + 1, updated_at: new Date().toISOString() }).eq("id", row.id)
}

/** Stores the answer for the current step and moves to the next one (or finishes: status "pedido"). */
export async function saveAnswer(db: Db, row: FlowRow, cfg: FlowConfig, text: string): Promise<{ done: boolean; nextMessage: string }> {
  const now = new Date().toISOString()
  const answers = [...(row.answers || []), { step: row.step, text: String(text).slice(0, 1500), at: now }]
  const lastQuestion = row.step > cfg.followups.length
  if (!lastQuestion) {
    await db.from("lead_flows").update({ answers, step: row.step + 1, last_inbound_at: now, invalid_tries: 0, updated_at: now }).eq("id", row.id)
    return { done: false, nextMessage: cfg.followups[row.step - 1] }
  }
  await db
    .from("lead_flows")
    .update({ answers, last_inbound_at: now, status: "pedido", requested_at: now, updated_at: now })
    .eq("id", row.id)
  return { done: true, nextMessage: cfg.done_message }
}

export function summarizeAnswers(row: FlowRow, labels: string[]): string {
  return (row.answers || []).map((a, i) => `${labels[i] || `Resposta ${i + 1}`}: ${a.text}`).join("\n")
}
