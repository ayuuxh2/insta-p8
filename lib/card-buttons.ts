import { isHttpUrl } from "./is-http-url"

/**
 * The canonical Card/Link button contract.
 *
 * `ResponseContent.card.buttons` is the ONE representation of a card's buttons:
 * the editor, the live preview, the automations API and the Instagram sender all
 * read and write this exact shape. This module is the single place that decides
 * what a valid button is, so validation can never drift between layers again.
 *
 * Contract (docs/API_DEVELOPER_DOCS.md §3, Meta "Send a Generic Template"):
 *   buttons: [{ type: "web_url" | "postback", title, url? | payload? }]
 *   - at most 3 per card (Meta: "A maximum of 3 buttons per element is supported")
 *   - only web_url and postback are supported
 *   - title is required
 *   - web_url requires an http(s) url
 *   - postback requires a payload
 */

export const MAX_CARD_BUTTONS = 3

export type CardButtonType = "web_url" | "postback"

export interface CardButton {
  type: CardButtonType
  title: string
  url?: string
  payload?: string
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * A human-readable description of the first problem with a card's buttons, or
 * null when they are valid/absent. Used by the automations API (reject with 400)
 * and by the editor (inline message + save guard) so the two never disagree.
 */
export function validateCardButtons(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) return "Card buttons must be a list."

  if (raw.length > MAX_CARD_BUTTONS) {
    return `A card can have at most ${MAX_CARD_BUTTONS} buttons — remove ${raw.length - MAX_CARD_BUTTONS} to continue.`
  }

  for (let i = 0; i < raw.length; i++) {
    const button = raw[i] as CardButton | null | undefined
    const n = i + 1
    if (!button || typeof button !== "object") return `Button ${n} is invalid.`
    if (button.type !== "web_url" && button.type !== "postback") {
      return `Button ${n} must be a link button or a flow button.`
    }

    const title = asTrimmedString(button.title)
    if (!title) return `Button ${n} needs a label.`

    if (button.type === "web_url") {
      const url = asTrimmedString(button.url)
      if (!url) return `Button ${n} ("${title}") needs a link URL.`
      if (!isHttpUrl(url)) return `Button ${n} ("${title}") needs a full http(s) link.`
    } else {
      const payload = asTrimmedString(button.payload)
      if (!payload) return `Button ${n} ("${title}") needs a flow keyword.`
    }
  }

  return null
}

/**
 * Canonical stored form: trimmed, and only the fields the button type actually
 * uses (a web_url button carries no payload, a postback button carries no url).
 *
 * Call only after `validateCardButtons` has passed — this trims/normalizes, it
 * does not reject. It drops nothing that is required, so what the preview shows
 * is what is persisted and what the sender puts on the wire.
 */
export function serializeCardButtons(raw: unknown): CardButton[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_CARD_BUTTONS).map((entry) => {
    const button = (entry ?? {}) as CardButton
    const type: CardButtonType = button.type === "postback" ? "postback" : "web_url"
    const title = asTrimmedString(button.title)

    if (type === "postback") {
      return { type, title, payload: asTrimmedString(button.payload) }
    }

    let url = asTrimmedString(button.url)
    // The editor historically accepted a doubled scheme; repair instead of failing.
    if (url.startsWith("https://https://")) url = url.replace("https://https://", "https://")
    return { type, title, url }
  })
}

/**
 * Label the live preview renders for a button. A button the user just added has
 * no label yet — the preview must still show the row (so it is never silently
 * invisible) and mark it as incomplete instead of hiding it.
 */
export function cardButtonPreviewLabel(
  button: Pick<CardButton, "title"> | null | undefined,
  index: number,
): { text: string; complete: boolean } {
  const title = asTrimmedString(button?.title)
  if (title) return { text: title, complete: true }
  return { text: `Button ${index + 1} — add a label`, complete: false }
}
