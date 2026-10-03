// Filters shared by the contacts list and the CSV export.

export interface ContactFilters {
  userId: string
  q?: string | null
  tag?: string | null
  follows?: string | null // "yes" | "no" | "unknown"
  status?: string | null // "active" | "out"
}

export function filtersFromSearchParams(params: URLSearchParams): ContactFilters | null {
  const userId = params.get("userId")
  if (!userId) return null
  return {
    userId,
    q: params.get("q"),
    tag: params.get("tag"),
    follows: params.get("follows"),
    status: params.get("status"),
  }
}

export function applyContactFilters(query: any, f: ContactFilters) {
  let q = query.eq("user_id", f.userId)
  const search = f.q?.trim().replace(/^@/, "").replace(/[%_\\]/g, "")
  if (search) q = q.ilike("username", `%${search}%`)
  if (f.tag) q = q.contains("tags", [f.tag])
  if (f.follows === "yes") q = q.eq("follows", true)
  else if (f.follows === "no") q = q.eq("follows", false)
  else if (f.follows === "unknown") q = q.is("follows", null)
  if (f.status === "active") q = q.eq("opted_out", false)
  else if (f.status === "out") q = q.eq("opted_out", true)
  return q
}

export const EVENT_LABELS: Record<string, string> = {
  comment: "Comentou",
  dm: "Mandou DM",
  story: "Interagiu no Story",
  optin_tap: 'Tocou em "Quero receber"',
  unlock_tap: 'Tocou em "Já segui"',
  opt_out: "Saiu da lista",
  opt_in: "Voltou para a lista",
  link_click: "Clicou no link",
  optin_sent: "Recebeu o cartão",
  gate_sent: "Recebeu pedido para seguir",
  content_sent: "Recebeu o conteúdo",
}
