import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { ensureSchema } from "@/lib/supabase-migrate"
import {
  sendTextDM,
  sendCardDM,
  sendMediaDM,
  sendSenderAction,
  replyToComment,
  fetchProfile,
  sleep,
  isHttpUrl,
  buildFollowGateCard,
} from "@/lib/instagram-api"
import { generateAIReply } from "@/lib/ai-reply"
import { bumpUnlockAttempt, clearUnlockAttempts, unlockKey } from "@/lib/unlock-tracking"
import {
  handleWebhookVerification,
  metaAppSecrets,
  signatureBypassEnabled,
  verifyMetaSignature,
} from "@/lib/webhook-verify"

// Reply delivery can legitimately sleep (human-like delays), call the AI provider
// (15s timeout) and then hit the Graph API. Vercel's default function limit is
// shorter than that, so a timed-out invocation could drop a reply mid-send.
export const maxDuration = 60

const DEFAULT_PUBLIC_REPLIES = ["Check your DMs! 📥", "Sent! 🔥", "Check inbox! ✨"]

// Max times we'll send the gate card for an unverifiable follow status on a single unlock event.
// After this, we send a single "couldn't verify your follow" message and stop spamming the user.
const UNLOCK_GATE_MAX_ATTEMPTS = 3

export async function GET(request: NextRequest) {
  // Meta webhook verification handshake — shared with /api/instagram/callback.
  return handleWebhookVerification(request.nextUrl.searchParams)
}

// ============================================================
// Content parsing — response_content may be object or JSON string
// ============================================================
function parseContent(raw: any) {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return { message: raw }
    }
  }
  return raw
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function keywordMatches(triggerValue: string, text: string): boolean {
  return triggerValue
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean)
    .some((k: string) => {
      try {
        return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
      } catch {
        return text.includes(k.toLowerCase())
      }
    })
}

// ============================================================
// Card / Link delivery
// ============================================================

// Instagram's generic template requires more than just a title (Meta: "at least
// one property must be set in addition to title"), so a bare-title card is sent
// as plain text instead of being rejected outright.
function cardHasRichContent(card: any): boolean {
  if (!card) return false
  return Boolean(
    card.subtitle ||
      isHttpUrl(card.image_url) ||
      isHttpUrl(card.url) ||
      (Array.isArray(card.buttons) && card.buttons.some((b: any) => b?.title)),
  )
}

function cardFallbackText(card: any): string {
  const parts = [card?.title, card?.subtitle].filter(Boolean)
  if (isHttpUrl(card?.url)) parts.push(card.url.trim())
  return parts.join("\n")
}

/**
 * Sends a Card/Link reply as a real Instagram generic template: cover image,
 * title, subtitle, the configured link as the tappable `default_action`, and up
 * to three buttons.
 *
 * If Meta rejects the template — the usual cause is an image_url it cannot fetch
 * (a web page instead of a direct image) — the failure is logged with Meta's
 * error and the same content is re-delivered as a supported media/text message,
 * so the recipient still receives the link instead of just the title.
 */
async function sendCardResponse(
  token: string,
  recipient: { id?: string; comment_id?: string },
  card: any,
) {
  if (!cardHasRichContent(card)) {
    if (card?.title) return sendTextDM(token, recipient, String(card.title))
    return { ok: false, error: "empty card" }
  }

  console.log(
    `[webhook] card send: image=${isHttpUrl(card.image_url)} link=${isHttpUrl(card.url)} buttons=${
      Array.isArray(card.buttons) ? card.buttons.filter((b: any) => b?.title).length : 0
    }`,
  )

  const result = await sendCardDM(token, recipient, card)
  if (result.ok) return result

  const imageUrl = isHttpUrl(card.image_url) ? card.image_url.trim() : null
  const text = cardFallbackText(card)
  console.warn(
    `[webhook] card template rejected by Meta — falling back to ${imageUrl ? "media + text" : "text"}; ` +
      `image_url=${imageUrl ? "set" : "none"} link=${isHttpUrl(card.url) ? "set" : "none"}`,
  )

  let sent: any = { ok: false, error: result.error }
  if (imageUrl) sent = await sendMediaDM(token, recipient, "image", imageUrl)
  if (text) {
    const textResult = await sendTextDM(token, recipient, text)
    if (textResult.ok) return textResult
    if (!sent.ok) sent = textResult
  }
  return sent
}

// ============================================================
// Unified response sender — handles text, card, media, quick
// replies, typing indicators, and human-like delays.
// ============================================================
async function sendAutomationResponse(
  token: string,
  recipient: { id?: string; comment_id?: string },
  content: any,
  opts: { skipTyping?: boolean } = {},
) {
  const delaySeconds = Number(content.delay_seconds) || 0
  const useTyping = content.typing_indicator === true && recipient.id && !opts.skipTyping

  if (useTyping) await sendSenderAction(token, recipient.id!, "typing_on")
  if (delaySeconds > 0) await sleep(delaySeconds * 1000)

  const quickReplies = Array.isArray(content.quick_replies)
    ? content.quick_replies
        .filter((q: any) => q?.title)
        .map((q: any) => ({ title: q.title, payload: q.payload || `QR_${q.title.toUpperCase().replace(/\s+/g, "_")}` }))
    : undefined

  let result
  if (content.media?.url) {
    result = await sendMediaDM(token, recipient, content.media.type || "image", content.media.url)
    if (result.ok && content.message) {
      result = await sendTextDM(token, recipient, content.message, quickReplies)
    }
  } else if (content.card) {
    result = await sendCardResponse(token, recipient, content.card)
  } else if (content.message) {
    result = await sendTextDM(token, recipient, content.message, quickReplies)
  } else {
    result = { ok: false, error: "empty content" }
  }

  if (useTyping) await sendSenderAction(token, recipient.id!, "typing_off")
  return result
}

function responsePreviewText(content: any): string {
  if (content.message) return content.message
  if (content.card) return `[Card] ${content.card.title}`
  if (content.media?.url) return `[${content.media.type || "media"}]`
  return "[automation]"
}

// ============================================================
// Instagram API Helper: Verifies actual follow status
// API: GET https://graph.instagram.com/v24.0/{IGSID}?fields=is_user_follow_business
//
// `is_user_follow_business` belongs to the Instagram User Profile API, which
// requires *user consent*. Per Meta, consent is set only when the user sends a
// message, clicks an icebreaker, or opens the persistent menu. A commenter who
// has never messaged the account therefore gets Meta error code 230
// ("User consent is required to access user profile"). That is a normal API
// state — NOT evidence that the user does not follow the account.
//
// Three-state result:
//   FOLLOWS         → Instagram explicitly returned is_user_follow_business: true
//   DOES_NOT_FOLLOW → Instagram explicitly returned is_user_follow_business: false
//   UNKNOWN         → consent/auth/permission/transient error, or an inconclusive
//                     payload. Never collapse UNKNOWN into DOES_NOT_FOLLOW.
// ============================================================
type FollowStatus = "FOLLOWS" | "DOES_NOT_FOLLOW" | "UNKNOWN"
type FollowUnknownReason = "consent" | "auth" | "transient" | "malformed"
interface FollowCheckResult {
  status: FollowStatus
  reason?: FollowUnknownReason
}

async function verifyFollowStatus(
  igScopedId: string,
  igAccessToken: string,
  event: "comment" | "story" | "dm" | "dm-unlock",
): Promise<FollowCheckResult> {
  // Never log the access token: only the IGSID and the triggering event.
  console.log(`[follow-gate] Checking follow status userId=${igScopedId} event=${event}`)
  try {
    // Same API version as every other Graph call in this app. v21.0 was the lone
    // exception and is past its deprecation window (Meta sunset v21.0 in 2025);
    // a removed version returns an error, which the gate would treat as transient
    // and FAIL OPEN — silently delivering gated content.
    //
    // Token type: Instagram user access token (Instagram Login) — the token type
    // the User Profile API requires, NOT a Facebook Page token.
    // ID type: the Instagram-scoped ID (IGSID) taken from the webhook payload.
    const url =
      `https://graph.instagram.com/v24.0/${encodeURIComponent(igScopedId)}` +
      `?fields=is_user_follow_business&access_token=${encodeURIComponent(igAccessToken)}`

    // 5s timeout -- Graph API is fast, anything longer means trouble
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })

    if (!response.ok) {
      // Read Meta's error body to tell a consent state apart from a transient
      // outage, but never log the raw body — only code/type/message.
      let errorBody: any = null
      try {
        errorBody = JSON.parse(await response.text())
      } catch {
        // Non-JSON body: fall through with the HTTP status only.
      }
      const meta = errorBody?.error ?? null
      const code = meta?.code

      // 230 = "User consent is required to access user profile". Expected when a
      // commenter has not messaged the account. The follow status is unknowable,
      // NOT false.
      if (code === 230) {
        console.warn(
          `[follow-gate] API result: UNKNOWN (userId=${igScopedId}) ` +
            `Instagram error code=230: user consent required`,
        )
        return { status: "UNKNOWN", reason: "consent" }
      }

      // 401/403 is an auth/permission failure: fail CLOSED (unchanged behaviour).
      // Still not evidence about following — it is UNKNOWN, not DOES_NOT_FOLLOW.
      if (response.status === 401 || response.status === 403) {
        console.warn(
          `[follow-gate] API result: UNKNOWN (userId=${igScopedId}) ` +
            `Instagram auth/permission error http=${response.status} code=${code ?? "-"}`,
        )
        return { status: "UNKNOWN", reason: "auth" }
      }

      // Any other error (5xx, 429, timeout, missing permission, ...) is transient:
      // fail OPEN so an API/availability problem never blocks the automation.
      console.warn(
        `[follow-gate] API result: UNKNOWN (userId=${igScopedId}) ` +
          `Instagram API error http=${response.status} code=${code ?? "-"} type=${meta?.type ?? "-"}`,
      )
      return { status: "UNKNOWN", reason: "transient" }
    }

    const data = await response.json()
    const value = data?.is_user_follow_business
    if (value === true) {
      console.log(`[follow-gate] API result: FOLLOWS (userId=${igScopedId})`)
      return { status: "FOLLOWS" }
    }
    if (value === false) {
      console.log(`[follow-gate] API result: DOES_NOT_FOLLOW (userId=${igScopedId})`)
      return { status: "DOES_NOT_FOLLOW" }
    }
    // A 200 without a boolean field is inconclusive, not a "no". Treating it as
    // DOES_NOT_FOLLOW previously showed "You don't follow us" to valid users.
    console.warn(
      `[follow-gate] API result: UNKNOWN (userId=${igScopedId}) is_user_follow_business missing from response`,
    )
    return { status: "UNKNOWN", reason: "malformed" }
  } catch (error: any) {
    // AbortSignal.timeout throws AbortError/TimeoutError; any other throw is a
    // network error. Both are transient and must never surface as a 500.
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError"
    console.warn(
      `[follow-gate] API result: UNKNOWN (userId=${igScopedId}) ` +
        `${timedOut ? "request timed out" : "network error"}`,
    )
    return { status: "UNKNOWN", reason: "transient" }
  }
}

// Unlock-attempt counter is in lib/unlock-tracking.ts -- uses Supabase
// unlock_attempts table so the 3-attempt cap works across Vercel instances.

// ============================================================
// Idempotency -- Meta retries webhook deliveries
// Incoming messages are stored under their Meta message id (messages.id), so an
// already-stored mid means this event was handled before. Without this check a
// retried delivery sent a second automated reply.
// Fails OPEN: if the lookup errors we process the event (same as before).
// ============================================================
async function alreadyProcessed(supabase: any, mid: string | null | undefined): Promise<boolean> {
  if (!mid) return false
  try {
    const { data, error } = await supabase.from("messages").select("id").eq("id", mid).limit(1)
    if (error) return false
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

// ============================================================
// Atomic webhook-event claim
// Meta retries deliveries, and two copies of the same event can arrive at the
// same time on different serverless instances. A SELECT-then-INSERT check races:
// both requests read "not seen yet" and BOTH reply. So the claim is a single
// INSERT against webhook_events.event_key, which carries a UNIQUE index. Postgres
// serialises concurrent inserts on that index: exactly one caller succeeds, every
// other caller gets 23505 (unique_violation) and must skip the side effects.
//
// Fails OPEN on unexpected errors (e.g. the column does not exist before the
// migration ran, or a transient DB error) so reply delivery keeps working.
// ============================================================
async function claimWebhookEvent(supabase: any, eventKey: string | null | undefined): Promise<boolean> {
  if (!eventKey) return true
  try {
    const { error } = await supabase
      .from("webhook_events")
      .insert({ event_type: "claim", event_key: eventKey, data: {} })
    if (!error) return true
    // 23505 = unique_violation: an earlier or concurrent delivery already owns it.
    if (error.code === "23505") return false
    console.warn("[webhook] event claim failed, processing anyway:", error.code ?? error.message)
    return true
  } catch (e: any) {
    console.warn("[webhook] event claim threw, processing anyway:", e?.message)
    return true
  }
}

// ============================================================
// Audit trail -- sanitized webhook receipt summary
// Stores event kinds and IG IDs only. Never stores tokens, signatures,
// headers, or message bodies.
// ============================================================
function describeMessagingEvent(event: any): string {
  if (event?.message?.is_echo) return "echo"
  if (event?.read) return "read"
  if (event?.delivery) return "delivery"
  if (event?.reaction) return "reaction"
  if (event?.message?.quick_reply) return "quick_reply"
  if (event?.postback) return "postback"
  if (event?.message?.attachments?.[0]?.type === "story_mention") return "story_mention"
  if (event?.message?.reply_to?.story) return "story_reply"
  if (event?.message) return "message"
  return "unknown"
}

function recordWebhookEvent(supabase: any, body: any) {
  try {
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : []
    const events = entries.flatMap((entry: any) =>
      (Array.isArray(entry?.messaging) ? entry.messaging : []).map((event: any) => ({
        sender: event?.sender?.id != null ? String(event.sender.id) : null,
        recipient: event?.recipient?.id != null ? String(event.recipient.id) : null,
        kind: describeMessagingEvent(event),
        mid: event?.message?.mid != null ? String(event.message.mid) : null,
      })),
    )
    const comments = entries.flatMap((entry: any) =>
      (Array.isArray(entry?.changes) ? entry.changes : []).map((change: any) => ({
        field: change?.field ?? "unknown",
        hasText: Boolean(change?.value?.text),
      })),
    )
    supabase
      .from("webhook_events")
      .insert({
        event_type: typeof body?.object === "string" ? body.object : "instagram",
        data: { entryCount: entries.length, events, comments },
      })
      .then(
        () => {},
        (e: any) => console.warn("[webhook] audit insert failed:", e?.message),
      )
  } catch (e: any) {
    console.warn("[webhook] audit failed:", e?.message)
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-hub-signature-256")
    const secrets = metaAppSecrets()
    if (!verifyMetaSignature(rawBody, signature, secrets)) {
      // Diagnostics stay at a safe level: presence / count / length only. No
      // token, secret, raw header value or signature material is logged.
      console.error(
        `[webhook] 401: ${!signature ? "no x-hub-signature-256 header" : "signature mismatch"}; ` +
          `secrets configured: ${secrets.length}; bodyLen=${rawBody.length}`,
      )
      // The bypass is a development-only escape hatch; it cannot be armed in production.
      if (!signatureBypassEnabled()) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
    }
    const body = JSON.parse(rawBody)
    if (!body.entry) return NextResponse.json({ ok: true })
    console.log(
      `[webhook] received object=${typeof body.object === "string" ? body.object : "-"} entries=${Array.isArray(body.entry) ? body.entry.length : 0}`,
    )
    // Ensure schema is up-to-date on every cold start (idempotent, no-op if all tables exist)
    ensureSchema().catch((e) => console.warn("[webhook] ensureSchema failed:", e?.message))
    const supabase = await getSupabaseServerClient()

    // Secret-free receipt trail. public.webhook_events existed in the schema but
    // was never written to, so "did Meta actually reach us?" was unanswerable
    // from the database. Fire-and-forget: auditing must never block delivery.
    void recordWebhookEvent(supabase, body)

    for (const entry of body.entry) {
      // Skip pure system events (echo / read / delivery)
      if (entry.messaging) {
        const isSystemEvent = entry.messaging.every(
          (event: any) => event.read || event.delivery || (event.message && event.message.is_echo),
        )
        if (isSystemEvent) continue
      }

      const webhookId = entry.id

      // ---------- User resolution: direct, payload fallback, token verify ----------
      let { data: user } = await supabase
        .from("users")
        .select("*")
        .or(`business_account_id.eq.${webhookId},page_id.eq.${webhookId}`)
        .single()

      if (!user) {
        const candidateIds = new Set<string>()
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
          }
        }
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
          }
        }
        for (const candidateId of candidateIds) {
          if (candidateId === webhookId) continue
          const { data: fallbackUser } = await supabase
            .from("users")
            .select("*")
            .or(`business_account_id.eq.${candidateId},page_id.eq.${candidateId}`)
            .single()
          if (fallbackUser) {
            await supabase.from("users").update({ page_id: webhookId }).eq("id", fallbackUser.id)
            user = fallbackUser
            break
          }
        }
      }

      // Deliberately NO O(n) scan over every account here. Resolution above is a
      // direct lookup on the indexed business_account_id / page_id columns, and
      // Meta guarantees a webhook entry.id equals the /me?fields=user_id value we
      // store. The old fallback called the Graph API once per account, per event —
      // an N-call latency spike and a self-inflicted rate-limit risk.
      if (!user) {
        console.log(`[webhook] ❌ Could not resolve user for ID ${webhookId}`)
        continue
      }

      const { data: automations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)

      if (!automations?.length) continue

      // ============================================================
      //  PART A: COMMENTS
      // ============================================================
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== "comments" || !change.value?.text) continue

          const commentId = change.value.id
          const commentText = change.value.text.toLowerCase().trim()
          const senderId = change.value.from.id
          const mediaId = change.value.media.id
          const parentId = change.value.parent_id || null

          if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

          const commentAutomations = automations.filter((a: any) => a.trigger_source === "comment")

          // Priority: specific post reply-all → specific post keyword → global keyword
          let match = commentAutomations.find(
            (a: any) => a.specific_media_id === mediaId && a.trigger_type === "reply_all",
          )
          if (!match) {
            match = commentAutomations.find(
              (a: any) =>
                a.specific_media_id === mediaId &&
                a.trigger_type === "keyword" &&
                keywordMatches(a.trigger_value, commentText),
            )
          }
          if (!match) {
            match = commentAutomations.find(
              (a: any) =>
                !a.specific_media_id &&
                a.trigger_type === "keyword" &&
                keywordMatches(a.trigger_value, commentText),
            )
          }
          if (!match) continue

                    const content = parseContent(match.response_content)

                    // Skip nested replies unless user opted in
                    if (parentId && content.include_replies !== true) continue

                    console.log(`[webhook] ✅ Comment match: "${match.name}"`)

                    // Meta retries comment deliveries: never reply twice for one comment.
                    // Atomic claim (not SELECT-then-INSERT) so simultaneous retries
                    // cannot both send a public reply + DM.
                    if (!(await claimWebhookEvent(supabase, `comment:${commentId}`))) {
                      console.log(`[webhook] ↩︎ duplicate comment delivery ignored (${commentId})`)
                      continue
                    }

                    // reply_mode: 'both' (default) | 'dm_only' | 'public_only'
                    const replyMode = content.reply_mode || "both"

                    // Helper: pick a public reply from user's rotation list (with defaults fallback)
                    const getPublicReply = (): string => {
                      const pool: string[] =
                        Array.isArray(content.public_replies) && content.public_replies.filter(Boolean).length > 0
                          ? content.public_replies.filter(Boolean)
                          : DEFAULT_PUBLIC_REPLIES
                      return pickRandom(pool)
                    }

                    // ===== FOLLOWER GATE FOR COMMENTS =====
                    // The gate card is delivered as a *private reply* to the comment. recipient.id
                    // alone won't open a DM with someone who has never messaged the account; private
                    // replies to a comment need comment_id.
                    if (content.check_follow === true) {
                      const followResult = await verifyFollowStatus(senderId, user.access_token, "comment")

                      if (followResult.status === "FOLLOWS") {
                        console.log(`[webhook] ✅ Comment follower gate: @${senderId} follows @${user.username} — sending content`)
                        if (replyMode !== "dm_only") {
                          await replyToComment(user.access_token, commentId, getPublicReply())
                        }
                        if (replyMode !== "public_only") {
                          await sendAutomationResponse(
                            user.access_token,
                            { comment_id: commentId },
                            content,
                            { skipTyping: true },
                          )
                        }
                      } else if (followResult.status === "DOES_NOT_FOLLOW") {
                        console.log(`[webhook] 🔒 Comment follower gate: @${senderId} doesn't follow @${user.username}`)
                        if (replyMode !== "dm_only") {
                          await replyToComment(user.access_token, commentId, getPublicReply())
                        }
                        if (replyMode !== "public_only") {
                          await sendCardDM(
                            user.access_token,
                            { comment_id: commentId },
                            buildFollowGateCard({ username: user.username, ruleId: match.id }),
                          )
                        }
                      } else {
                        // UNKNOWN → unverifiable. Auth/permission errors fail CLOSED; consent,
                        // transient and malformed results fail OPEN (never a false "no").
                        const isAuthError = followResult.reason === "auth"
                        if (isAuthError) {
                          // Auth/permission failure — fail CLOSED: send gate card
                          console.warn(`[webhook] ⚠️ Comment follower gate auth failure for @${senderId}; sending gate`)
                          if (replyMode !== "dm_only") {
                            await replyToComment(user.access_token, commentId, getPublicReply())
                          }
                          if (replyMode !== "public_only") {
                            await sendCardDM(
                              user.access_token,
                              { comment_id: commentId },
                              buildFollowGateCard({ username: user.username, ruleId: match.id }),
                            )
                          }
                        } else {
                          // Transient failure — fail OPEN: deliver content (with public reply if allowed)
                          console.warn(`[webhook] ⚠️ Comment follower gate transient failure for @${senderId}; failing open`)
                          if (replyMode !== "dm_only") {
                            await replyToComment(user.access_token, commentId, getPublicReply())
                          }
                          if (replyMode !== "public_only") {
                            await sendAutomationResponse(
                              user.access_token,
                              { comment_id: commentId },
                              content,
                              { skipTyping: true },
                            )
                          }
                        }
                      }
                    } else {
                      // No follower check required — send normally
                      if (replyMode !== "dm_only") {
                        await replyToComment(user.access_token, commentId, getPublicReply())
                      }
                      if (replyMode !== "public_only") {
                        await sendAutomationResponse(
                          user.access_token,
                          { comment_id: commentId },
                          content,
                          { skipTyping: true },
                        )
                      }
                    }
        }
      }

      // ============================================================
      //  PART A.5: STORY AUTOMATIONS (mention / reaction / reply)
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const senderId = event.sender.id
          const recipientId = event.recipient.id
          if (event.read || event.delivery || event.message?.is_echo || senderId === recipientId) continue

          const storyAutomations = automations.filter((a: any) => a.trigger_source === "story")
          if (storyAutomations.length === 0) continue

          let match: any = null
          let storyMediaId: string | null = null

          if (event.message?.attachments?.[0]?.type === "story_mention") {
            storyMediaId = event.message.attachments[0].payload?.url || null
            match = storyAutomations.find(
              (a: any) => a.trigger_type === "mention" && (!a.specific_media_id || a.specific_media_id === storyMediaId),
            )
          } else if (event.reaction) {
            const reactionEmoji = event.reaction.emoji
            storyMediaId = event.reaction.mid || null
            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== "reaction") return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false
              const triggers = a.trigger_value?.split(",").map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== "ALL" && triggers[0] !== "ALL_REACTIONS" && triggers[0] !== "") {
                return triggers.includes(reactionEmoji)
              }
              return true
            })
          } else if (event.message?.reply_to?.story) {
            const messageText = event.message.text || ""
            storyMediaId = event.message.reply_to.story.id || null
            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== "reply") return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false
              const triggers = a.trigger_value?.split(",").map((t: string) => t.trim()) || []
              if (
                triggers.length > 0 &&
                triggers[0] !== "ALL" &&
                triggers[0] !== "ALL_MENTIONS" &&
                triggers[0] !== ""
              ) {
                return keywordMatches(a.trigger_value, messageText)
              }
              return true
            })
          }

          if (match) {
                                          // Story deliveries are retried too. Claim before any send so a
                                          // concurrent duplicate cannot deliver the automation twice.
                                          const storyKey = `story:${event.message?.mid ?? event.reaction?.mid ?? ""}:${senderId}:${event.timestamp ?? ""}`
                                          if (!(await claimWebhookEvent(supabase, storyKey))) {
                                            console.log(`[webhook] ↩︎ duplicate story delivery ignored (${storyKey})`)
                                            continue
                                          }
                                          console.log(`[webhook] ✨ Story match: "${match.name}"`)
                                          const content = parseContent(match.response_content)

                                          if (content.check_follow === true) {
                                            const followResult = await verifyFollowStatus(senderId, user.access_token, "story")

                                            if (followResult.status === "FOLLOWS") {
                                              console.log(`[webhook] ✅ Story follower gate: @${senderId} follows @${user.username} — sending content`)
                                              await sendAutomationResponse(user.access_token, { id: senderId }, content)
                                            } else if (followResult.status === "DOES_NOT_FOLLOW") {
                                              console.log(`[webhook] 🔒 Story follower gate: @${senderId} doesn't follow @${user.username}`)
                                              await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id }))
                                            } else {
                                              // UNKNOWN → unverifiable. Auth/permission errors fail CLOSED;
                                              // consent, transient and malformed results fail OPEN.
                                              const isAuthError = followResult.reason === "auth"
                                              if (isAuthError) {
                                                // Auth failure — fail CLOSED: send gate
                                                console.warn(`[webhook] ⚠️ Story follower gate auth failure for @${senderId}; sending gate`)
                                                await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id }))
                                              } else {
                                                // Transient failure — fail OPEN: deliver content
                                                console.warn(`[webhook] ⚠️ Story follower gate transient failure for @${senderId}; failing open`)
                                                await sendAutomationResponse(user.access_token, { id: senderId }, content)
                                              }
                                            }
                                          } else {
                                            // No follower check required — send normally
                                            await sendAutomationResponse(user.access_token, { id: senderId }, content)
                                          }
                                        }
        }
      }

      // ============================================================
      //  PART B: DIRECT MESSAGES
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.read || event.delivery || event.reaction || event.message?.is_echo) continue

          const senderId = event.sender.id
          if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

          let triggerType = ""
          let triggerValue = ""

          if (event.message?.quick_reply?.payload) {
            triggerType = "postback"
            triggerValue = event.message.quick_reply.payload
          } else if (event.message?.text) {
            triggerType = "keyword"
            triggerValue = event.message.text.toLowerCase().trim()
          } else if (event.postback?.payload) {
            triggerType = "postback"
            triggerValue = event.postback.payload
          } else {
            continue
          }

          console.log(`[webhook] 📩 DM from ${senderId}: "${triggerValue}"`)

          // Meta retries deliveries; never reply twice for the same message id.
          const mid = event.message?.mid
          if (await alreadyProcessed(supabase, mid)) {
            console.log(`[webhook] ↩︎ duplicate delivery ignored (mid=${mid})`)
            continue
          }

          // Atomic claim for the concurrent case: a retry landing while this delivery
          // is still being processed must not send a second reply. Postbacks carry no
          // mid, so fall back to a stable key (payload id, or sender+payload+timestamp).
          const eventKey = mid
            ? `mid:${mid}`
            : event.postback?.mid
              ? `postback:${event.postback.mid}`
              : triggerType === "postback"
                ? `postback:${senderId}:${triggerValue}:${event.timestamp ?? ""}`
                : null
          if (!(await claimWebhookEvent(supabase, eventKey))) {
            console.log(`[webhook] ↩︎ duplicate delivery ignored (key=${eventKey})`)
            continue
          }

          // Inbox bookkeeping runs alongside delivery, not ahead of it. Always
          // joined below so serverless shutdown cannot discard pending writes.
          const incomingSaved = (async () => {
          let conv: any = null
          try {
            const { data: existing } = await supabase
              .from("conversations")
              .select("id")
              .eq("user_id", user.id)
              .eq("recipient_id", senderId)
              .single()

            if (!existing) {
              let realUsername = `cnt_${senderId.slice(0, 5)}...`
              const profile = await fetchProfile(user.access_token, senderId)
              if (profile?.username) realUsername = profile.username

              const { data: newConv } = await supabase
                .from("conversations")
                .insert({
                  user_id: user.id,
                  recipient_id: senderId,
                  recipient_username: realUsername,
                  last_message_at: new Date().toISOString(),
                })
                .select("id")
                .single()
              conv = newConv
            } else {
              conv = existing
              await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", existing.id)
            }

            if (conv) {
              await supabase.from("messages").insert({
                id: event.message?.mid || `mid_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                user_id: user.id,
                sender_id: senderId,
                sender_username: "User",
                content: triggerValue,
                is_from_instagram: true,
              })
            }
          } catch (err) {
            console.error("[webhook] Failed to save incoming message", err)
          }
          return conv
          })()

          try {
          // ---------- Match automation ----------
                    const dmAutomations = automations.filter((a: any) => a.trigger_source === "dm" || !a.trigger_source)
                    let match: any = null

                    const isUnlockEvent = triggerType === "postback" && triggerValue.startsWith("UNLOCK_CONTENT_")

                    if (triggerType === "postback") {
                      if (isUnlockEvent) {
                        const ruleId = triggerValue.replace("UNLOCK_CONTENT_", "")
                        match = automations.find((a) => a.id === ruleId)
                      } else if (triggerValue.startsWith("ICE_BREAKER_")) {
                        const iceBreakerId = triggerValue.replace("ICE_BREAKER_", "")
                        const { data: ib } = await supabase
                          .from("ice_breakers")
                          .select("*")
                          .eq("id", iceBreakerId)
                          .eq("user_id", user.id)
                          .single()
                        if (ib) {
                          match = { name: "Ice Breaker: " + ib.question, response_content: { message: ib.response } }
                        }
                      } else {
                        match = automations.find((a) => a.trigger_type === "postback" && a.trigger_value === triggerValue)
                        // Quick reply payloads can also match keyword rules
                        if (!match) {
                          match = dmAutomations.find(
                            (a) => a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue.toLowerCase()),
                          )
                        }
                      }
                    } else {
                      match = dmAutomations.find(
                        (a) => a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue),
                      )
                    }

                    if (!match) {
                      // AI fallback: if no keyword rule matched, try AI auto-reply
                      if (user.groq_auto_reply_enabled && triggerType !== "postback") {
                        console.log(`[webhook] 🤖 No rule match — trying AI auto-reply for DM from ${senderId}`)
                        await sendSenderAction(user.access_token, senderId, "mark_seen")
                        const conv = await incomingSaved // AI needs history; keyword replies do not.
                        const { data: recentMessages } = conv
                          ? await supabase
                              .from("messages")
                              .select("content, is_from_instagram")
                              .eq("conversation_id", conv.id)
                              .order("created_at", { ascending: false })
                              .limit(10)
                          : { data: [] }
                        const history = (recentMessages || []).reverse().map((message: any) => ({
                          role: message.is_from_instagram ? "user" as const : "assistant" as const,
                          content: message.content,
                        }))
                        const aiReply = await generateAIReply(triggerValue, user.ai_context || "", history, user.groq_api_key, user.ai_base_url, user.ai_model)
                        if (aiReply) {
                          await sendSenderAction(user.access_token, senderId, "typing_on")
                          const result = await sendTextDM(user.access_token, { id: senderId }, aiReply)
                          if (result?.ok && conv) {
                            try {
                              await supabase.from("messages").insert({
                                id: `mid_ai_${Date.now()}_${Math.random()}`,
                                conversation_id: conv.id,
                                user_id: user.id,
                                sender_id: user.business_account_id,
                                sender_username: user.username,
                                content: aiReply,
                                is_from_instagram: false,
                              })
                            } catch (e) {
                              console.error("[webhook] Failed to save AI reply", e)
                            }
                          }
                        }
                      }
                      continue
                    }

                    if (!match) continue

                    console.log(`[webhook] ✅ DM match: "${match.name}"`)
                    const content = parseContent(match.response_content)

                    // Mark message as seen for human-like flow
                    if (content.mark_seen !== false) {
                      await sendSenderAction(user.access_token, senderId, "mark_seen")
                    }

                    // ---------- Follow gate for DMs ----------
                    const attemptKey = unlockKey(senderId, match.id)

                    if (content.check_follow === true) {
                      if (isUnlockEvent) {
                        // Explicit unlock path: user tapped "I Followed!" — re-verify before delivering.
                        // Rate-limit gate cards on unverifiable results; after N attempts, send a single
                        // "we couldn't verify" message and stop responding for this sender+rule.
                        const followResult = await verifyFollowStatus(senderId, user.access_token, "dm-unlock")

                        if (followResult.status === "FOLLOWS") {
                          await clearUnlockAttempts(attemptKey)
                          console.log(`[webhook] ✅ DM unlock verified for @${senderId}`)
                          const result = await sendAutomationResponse(user.access_token, { id: senderId }, content)
                          const conv = await incomingSaved
                          if (result?.ok && conv) {
                            try {
                              await supabase.from("messages").insert({
                                id: `mid_reply_${Date.now()}_${Math.random()}`,
                                conversation_id: conv.id,
                                user_id: user.id,
                                sender_id: user.business_account_id,
                                sender_username: user.username,
                                content: responsePreviewText(content),
                                is_from_instagram: false,
                              })
                            } catch (e) {
                              console.error("[webhook] Failed to save outgoing message", e)
                            }
                          }
                        } else if (followResult.status === "DOES_NOT_FOLLOW") {
                          await clearUnlockAttempts(attemptKey)
                          console.log(`[webhook] ❌ DM unlock rejected: @${senderId} still doesn't follow`)
                          const result = await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id, title: "❌ Not Following Yet!", subtitle: `We couldn't verify your follow. Please follow @${user.username} and click the button again.` }))
                          const conv = await incomingSaved
                          if (result?.ok && conv) {
                            try {
                              await supabase.from("messages").insert({
                                id: `mid_reply_${Date.now()}_${Math.random()}`,
                                conversation_id: conv.id,
                                user_id: user.id,
                                sender_id: user.business_account_id,
                                sender_username: user.username,
                                content: "[Verification Failed]",
                                is_from_instagram: false,
                              })
                            } catch (e) {
                              console.error("[webhook] Failed to save outgoing message", e)
                            }
                          }
                        } else {
                                                  // UNKNOWN → unverifiable. Cap the retry loop so a consent/auth
                                                  // problem cannot spam the gate card indefinitely.
                                                  const attempts = await bumpUnlockAttempt(attemptKey)
                                                  if (attempts > UNLOCK_GATE_MAX_ATTEMPTS) {
                                                    await clearUnlockAttempts(attemptKey)
                                                    console.warn(`[webhook] ⚠️ DM unlock gate capped after ${attempts} unverifiable attempts for @${senderId} / rule ${match.id}`)
                                                    const result = await sendTextDM(
                                                      user.access_token,
                                                      { id: senderId },
                                                      "⚠️ We couldn't verify your follow yet. Please reach out if this keeps happening.",
                                                    )
                                                    const conv = await incomingSaved
                                                    if (result?.ok && conv) {
                                                      try {
                                                        await supabase.from("messages").insert({
                                                          id: `mid_reply_${Date.now()}_${Math.random()}`,
                                                          conversation_id: conv.id,
                                                          user_id: user.id,
                                                          sender_id: user.business_account_id,
                                                          sender_username: user.username,
                                                          content: "[Verification Unavailable — capped]",
                                                          is_from_instagram: false,
                                                        })
                                                      } catch (e) {
                                                        console.error("[webhook] Failed to save outgoing message", e)
                                                      }
                                                    }
                                                  } else {
                                                    console.warn(`[webhook] ⚠️ DM unlock unverifiable (attempt ${attempts}/${UNLOCK_GATE_MAX_ATTEMPTS}) for @${senderId}`)
                                                    const result = await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id, subtitle: `Please follow @${user.username} to see this!` }))
                                                    const conv = await incomingSaved
                                                    if (result?.ok && conv) {
                                                      try {
                                                        await supabase.from("messages").insert({
                                                          id: `mid_reply_${Date.now()}_${Math.random()}`,
                                                          conversation_id: conv.id,
                                                          user_id: user.id,
                                                          sender_id: user.business_account_id,
                                                          sender_username: user.username,
                                                          content: `[Locked Content Gate — attempt ${attempts}/${UNLOCK_GATE_MAX_ATTEMPTS}]`,
                                                          is_from_instagram: false,
                                                        })
                                                      } catch (e) {
                                                        console.error("[webhook] Failed to save outgoing message", e)
                                                      }
                                                    }
                                                  }
                                                }
                                              } else {
                                                // Initial keyword/postback (not the unlock event) — verify once before locking
                                                const followResult = await verifyFollowStatus(senderId, user.access_token, "dm")

                                                if (followResult.status === "FOLLOWS") {
                          await clearUnlockAttempts(attemptKey)
                          console.log(`[webhook] ✅ DM follower gate: @${senderId} follows @${user.username} — sending content`)
                          const result = await sendAutomationResponse(user.access_token, { id: senderId }, content)
                          const conv = await incomingSaved
                          if (result?.ok && conv) {
                            try {
                              await supabase.from("messages").insert({
                                id: `mid_reply_${Date.now()}_${Math.random()}`,
                                conversation_id: conv.id,
                                user_id: user.id,
                                sender_id: user.business_account_id,
                                sender_username: user.username,
                                content: responsePreviewText(content),
                                is_from_instagram: false,
                              })
                            } catch (e) {
                              console.error("[webhook] Failed to save outgoing message", e)
                            }
                          }
                        } else if (followResult.status === "DOES_NOT_FOLLOW") {
                          await clearUnlockAttempts(attemptKey)
                          console.log(`[webhook] 🔒 DM follower gate: @${senderId} doesn't follow @${user.username}`)
                          const result = await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id, subtitle: `Please follow @${user.username} to see this!` }))
                          const conv = await incomingSaved
                          if (result?.ok && conv) {
                            try {
                              await supabase.from("messages").insert({
                                id: `mid_reply_${Date.now()}_${Math.random()}`,
                                conversation_id: conv.id,
                                user_id: user.id,
                                sender_id: user.business_account_id,
                                sender_username: user.username,
                                content: "[Locked Content Gate]",
                                is_from_instagram: false,
                              })
                            } catch (e) {
                              console.error("[webhook] Failed to save outgoing message", e)
                            }
                          }
                        } else {
                          // UNKNOWN → unverifiable. Auth/permission errors fail CLOSED: send the
                          // gate, don't deliver content (matches comment/story branches). Consent,
                          // transient and malformed results fail OPEN and deliver content.
                          const isAuthError = followResult.reason === "auth"
                          if (isAuthError) {
                            console.warn(`[webhook] ⚠️ DM follower gate auth failure for @${senderId}; sending gate`)
                            const result = await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id, title: "❌ Verification Failed", subtitle: `We can't verify your follow status. Please follow @${user.username} and try again.` }))
                            const conv = await incomingSaved
                            if (result?.ok && conv) {
                              try {
                                await supabase.from("messages").insert({
                                  id: `mid_reply_${Date.now()}_${Math.random()}`,
                                  conversation_id: conv.id,
                                  user_id: user.id,
                                  sender_id: user.business_account_id,
                                  sender_username: user.username,
                                  content: "[Auth Failure — Gate Sent]",
                                  is_from_instagram: false,
                                })
                              } catch (e) {
                                console.error("[webhook] Failed to save outgoing message", e)
                              }
                            }
                          } else {
                            // Transient failure — fail OPEN on initial trigger
                            console.warn(`[webhook] ⚠️ DM follower gate transient failure for @${senderId}; failing open on initial trigger`)
                            const result = await sendAutomationResponse(user.access_token, { id: senderId }, content)
                            const conv = await incomingSaved
                            if (result?.ok && conv) {
                              try {
                                await supabase.from("messages").insert({
                                  id: `mid_reply_${Date.now()}_${Math.random()}`,
                                  conversation_id: conv.id,
                                  user_id: user.id,
                                  sender_id: user.business_account_id,
                                  sender_username: user.username,
                                  content: responsePreviewText(content),
                                  is_from_instagram: false,
                                })
                              } catch (e) {
                                console.error("[webhook] Failed to save outgoing message", e)
                              }
                            }
                          }
                        }
                      }
                    } else {
                      // No follower check required
                      const result = await sendAutomationResponse(user.access_token, { id: senderId }, content)
                      const conv = await incomingSaved
                      if (result?.ok && conv) {
                        try {
                          await supabase.from("messages").insert({
                            id: `mid_reply_${Date.now()}_${Math.random()}`,
                            conversation_id: conv.id,
                            user_id: user.id,
                            sender_id: user.business_account_id,
                            sender_username: user.username,
                            content: responsePreviewText(content),
                            is_from_instagram: false,
                          })
                        } catch (e) {
                          console.error("[webhook] Failed to save outgoing message", e)
                        }
                      }
                    }
          } finally {
            await incomingSaved
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[webhook] Error", error)
    return NextResponse.json({ ok: true })
  }
}
