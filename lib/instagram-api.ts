const GRAPH = "https://graph.instagram.com/v24.0"

export interface IGButton {
  type: "web_url" | "postback"
  title: string
  url?: string
  payload?: string
}

export interface IGCard {
  title: string
  subtitle?: string
  image_url?: string
  buttons: IGButton[]
}

export interface QuickReply {
  title: string
  payload: string
}

export interface SendResult {
  ok: boolean
  id?: string
  error?: any
}

async function post(path: string, token: string, body: any): Promise<SendResult> {
  try {
    const res = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok || json.error) {
      console.error(`[ig-api] ${path} failed:`, JSON.stringify(json.error))
      return { ok: false, error: json.error || `HTTP ${res.status}` }
    }
    return { ok: true, id: json.id || json.message_id }
  } catch (e) {
    console.error(`[ig-api] ${path} network error:`, e)
    return { ok: false, error: e }
  }
}

export function buildCardAttachment(card: IGCard) {
  const buttons = (card.buttons || [])
    .filter((b) => b.title)
    .map((b) => ({
      type: b.type,
      title: b.title,
      url: b.type === "web_url" ? b.url : undefined,
      payload: b.type === "postback" ? b.payload : undefined,
    }))
  const element: any = { title: card.title, buttons }
  if (card.subtitle) element.subtitle = card.subtitle
  if (card.image_url?.startsWith("http")) element.image_url = card.image_url
  return {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: [element] },
    },
  }
}

// Postback payload prefixes for the follow-gate flow. The rule id follows the prefix.
export const OPTIN_PAYLOAD_PREFIX = "WANT_"
export const UNLOCK_PAYLOAD_PREFIX = "UNLOCK_CONTENT_"

/**
 * First message of a follow-gated comment rule, sent as a private reply.
 * Instagram only lets us check `is_user_follow_business` after the person
 * interacts in the DM, so we ask them to tap a button before checking.
 */
export function buildOptInCard(params: {
  ruleId: string
  title?: string
  subtitle?: string
  buttonTitle?: string
}): IGCard {
  return {
    title: params.title?.trim() || "Quer receber? 🎁",
    subtitle: params.subtitle?.trim() || "Toque no botão abaixo que eu te envio aqui no direct.",
    buttons: [
      { type: "postback", title: (params.buttonTitle?.trim() || "Quero receber").slice(0, 20), payload: `${OPTIN_PAYLOAD_PREFIX}${params.ruleId}` },
    ],
  }
}

/**
 * Whether the person follows the business account. Only valid after they interacted
 * in the DM (message, button tap, story reply). Returns null when Instagram could not
 * answer; callers must treat null as "not confirmed" and never deliver gated content.
 */
export async function checkFollowsBusiness(token: string, igScopedId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${GRAPH}/${igScopedId}?fields=is_user_follow_business`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    const json = await res.json()
    if (!res.ok || json.error) {
      console.error(`[ig-api] follow check failed (${res.status}):`, json.error?.code, json.error?.message)
      return null
    }
    if (typeof json.is_user_follow_business !== "boolean") return null
    return json.is_user_follow_business
  } catch (e: any) {
    console.error("[ig-api] follow check network error:", e?.name || e)
    return null
  }
}

/**
 * Build the follower-gate card shown to non-followers. Centralized so the
 * comment, story, and DM branches all share the same copy and the same
 * `as const` button types — preserving the `"web_url"` / `"postback"`
 * literal types that `IGButton` requires.
 */
export function buildFollowGateCard(params: {
  username: string
  ruleId: string
  title?: string
  subtitle?: string
}): IGCard {
  return {
    title: params.title ?? "Quase lá! 👀",
    subtitle: params.subtitle ?? `Siga a @${params.username} e toque em "Já segui" para receber.`,
    buttons: [
      { type: "web_url", url: `https://instagram.com/${params.username}`, title: "Seguir" },
      { type: "postback", title: "Já segui ✅", payload: `${UNLOCK_PAYLOAD_PREFIX}${params.ruleId}` },
    ],
  }
}

export async function sendTextDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  text: string,
  quickReplies?: QuickReply[],
): Promise<SendResult> {
  const message: any = { text }
  if (quickReplies?.length) {
    message.quick_replies = quickReplies.slice(0, 13).map((q) => ({
      content_type: "text",
      title: q.title.slice(0, 20),
      payload: q.payload,
    }))
  }
  return post("me/messages", token, { recipient, message })
}

export async function sendCardDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  card: IGCard,
): Promise<SendResult> {
  return post("me/messages", token, { recipient, message: buildCardAttachment(card) })
}

export async function sendMediaDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  mediaType: "image" | "video" | "audio",
  url: string,
): Promise<SendResult> {
  return post("me/messages", token, {
    recipient,
    message: { attachment: { type: mediaType, payload: { url } } },
  })
}

export async function sendSenderAction(
  token: string,
  recipientId: string,
  action: "typing_on" | "typing_off" | "mark_seen",
): Promise<SendResult> {
  return post("me/messages", token, { recipient: { id: recipientId }, sender_action: action })
}

export async function sendMessageReaction(
  token: string,
  recipientId: string,
  messageId: string,
  reaction = "love",
): Promise<SendResult> {
  return post("me/messages", token, {
    recipient: { id: recipientId },
    sender_action: "react",
    payload: { message_id: messageId, reaction },
  })
}

export async function replyToComment(token: string, commentId: string, message: string): Promise<SendResult> {
  return post(`${commentId}/replies`, token, { message })
}

export async function fetchProfile(token: string, igUserId: string): Promise<{ username?: string; name?: string } | null> {
  try {
    const res = await fetch(`${GRAPH}/${igUserId}?fields=username,name&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) })
    const json = await res.json()
    if (!res.ok || json.error) return null
    return json
  } catch {
    return null
  }
}

export async function verifyIdOwnership(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${id}?fields=id&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.min(ms, 8000)))
}
