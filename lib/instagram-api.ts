import { isHttpUrl } from "./is-http-url"
import { resolvePublicHost } from "./url-safety"
import { redactSecrets } from "./redact"

const GRAPH = "https://graph.instagram.com/v24.0"

export { isHttpUrl }

export interface IGButton {
  type: "web_url" | "postback"
  title: string
  url?: string
  payload?: string
}

export interface IGCard {
  title: string
  subtitle?: string
  /** Direct image URL (Meta cURLs it, so it must be a real image, not a web page). */
  image_url?: string
  /** Destination link rendered as the template's default_action (tap-to-open). */
  url?: string
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

/**
 * Single POST path for every Meta send call. Adds a 15s timeout, folds Meta's
 * error fields into a structured result, and redacts the token out of any
 * network error before it is logged (the request URL carries it).
 */
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
      // Safe diagnostics: status + Meta's own error fields. Never the access token.
      const meta = json?.error
      console.error(
        `[ig-api] ${path} failed: HTTP ${res.status}` +
          (meta
            ? ` type=${meta.type ?? "-"} code=${meta.code ?? "-"} subcode=${meta.error_subcode ?? "-"} message=${meta.message ?? "-"}`
            : ""),
      )
      return { ok: false, error: json.error || `HTTP ${res.status}` }
    }
    return { ok: true, id: json.id || json.message_id }
  } catch (e) {
    // The thrown error can embed the request URL, which carries the access
    // token. Redact before it reaches the log.
    console.error(`[ig-api] ${path} network error:`, redactSecrets(e))
    return { ok: false, error: e }
  }
}

/** Meta caps generic-template title/subtitle at 80 characters; longer values make it reject the whole message. */
function clamp80(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

/**
 * Builds the Instagram generic template that actually carries the image, text
 * and link.
 *
 * Instagram's generic template supports: title, subtitle, image_url, a
 * `default_action` (what opens when the card is tapped) and up to three
 * web_url/postback buttons. The previous implementation never set
 * `default_action`, so the configured link was dropped — recipients saw only
 * the title/subtitle. It also always attached an empty `buttons: []` array,
 * which is not a usable button list.
 */
export function buildCardAttachment(card: IGCard) {
  const buttons = (card.buttons || [])
    .filter((b) => b.title && (b.type === "web_url" ? isHttpUrl(b.url) : Boolean(b.payload)))
    .slice(0, 3)
    .map((b) =>
      b.type === "web_url"
        ? { type: "web_url" as const, title: b.title, url: b.url!.trim() }
        : { type: "postback" as const, title: b.title, payload: b.payload },
    )

  const element: any = { title: clamp80(card.title) ?? card.title }
  const subtitle = clamp80(card.subtitle)
  if (subtitle) element.subtitle = subtitle
  if (isHttpUrl(card.image_url)) element.image_url = card.image_url.trim()
  // Tapping the card opens this link. Without it, "Card / Link" had no link at all.
  if (isHttpUrl(card.url)) element.default_action = { type: "web_url", url: card.url.trim() }
  if (buttons.length) element.buttons = buttons

  return {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: [element] },
    },
  }
}

/** Redirects are followed manually so every hop can be re-validated. */
const IMAGE_PROBE_MAX_REDIRECTS = 3

/**
 * Best-effort check that a card image URL is a real, publicly fetchable image.
 *
 * Instagram fetches `image_url` itself. A web page URL (e.g. a Bing Images
 * search/detail page) is HTML, so Meta cannot render it and the card arrives
 * with no image. Two things block a save: a destination that is not publicly
 * routable, and a definitive non-image content-type. A reachable host that
 * simply refuses HEAD is tolerated, because a valid URL our server cannot probe
 * should not be rejected.
 *
 * SECURITY: this makes a server-side request to a user-supplied URL, so every
 * hop (the original URL *and* each redirect target) is resolved and rejected if
 * it is not publicly routable. Redirects are handled explicitly with
 * `redirect: "manual"` because auto-following would let a public host bounce the
 * request into the internal network. A private/internal destination is rejected
 * rather than probed, so the server never connects to it.
 */
export async function validateImageUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
  if (!isHttpUrl(url)) {
    return { valid: false, reason: "The card image URL must be a full http(s) link." }
  }
  try {
    let current = url.trim()
    for (let hop = 0; hop <= IMAGE_PROBE_MAX_REDIRECTS; hop++) {
      const destination = await resolvePublicHost(new URL(current).hostname)
      if (!destination.ok) {
        return {
          valid: false,
          reason:
            destination.reason === "unresolvable host"
              ? "That image URL's host could not be resolved. Use a publicly reachable image link."
              : "That image URL points to a private or internal address, so Instagram will not be able to fetch it. Use a publicly reachable image link.",
        }
      }

      const res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
      })

      const location = res.headers.get("location")
      if (res.status >= 300 && res.status < 400 && location) {
        // Resolve the hop against the current URL, then loop to validate it.
        current = new URL(location, current).toString()
        continue
      }

      if (!res.ok) return { valid: true }
      const type = (res.headers.get("content-type") || "").toLowerCase()
      if (!type || type.startsWith("image/")) return { valid: true }
      return {
        valid: false,
        reason: `That image URL serves "${type.split(";")[0]}" instead of an image. Paste a direct image link (ending in .jpg, .png, .webp…), not a website page.`,
      }
    }
    return { valid: false, reason: "That image URL redirects too many times. Use the direct image link." }
  } catch {
    return { valid: true }
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
    title: params.title ?? "Before you lose me",
    subtitle: params.subtitle ?? `Follow @${params.username} to unlock this content!`,
    buttons: [
      { type: "web_url", url: `https://instagram.com/${params.username}`, title: "Follow" },
      { type: "postback", title: "I Followed! ✅", payload: `UNLOCK_CONTENT_${params.ruleId}` },
    ],
  }
}

/**
 * Send a text DM (optionally with quick replies). `recipient.comment_id` sends a
 * private reply to a comment — the only way to open a DM with someone who has
 * never messaged the account. Meta caps quick replies at 13 and titles at 20
 * characters, so both are clamped here.
 */
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

/** Send a Card/Link reply as a generic template (see `buildCardAttachment`). */
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

/** Toggle the typing bubble / mark-seen. Requires a real recipient id (not comment_id). */
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

/** Post a public reply under a comment. Fails outside the comment's private-reply window. */
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

/**
 * Confirm a scoped id belongs to the account that owns `token` by requesting it
 * from the Graph API. Fails closed (false) on any error or non-2xx, so a lookup
 * failure can never be mistaken for ownership.
 */
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
