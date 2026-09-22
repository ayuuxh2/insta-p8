/* @ts-nocheck */

import crypto from "crypto"
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
  verifyIdOwnership,
  sleep,
  isHttpUrl,
  buildFollowGateCard,
} from "@/lib/instagram-api"
import { generateAIReply } from "@/lib/ai-reply"
import { bumpUnlockAttempt, clearUnlockAttempts, unlockKey } from "@/lib/unlock-tracking"
import { handleWebhookVerification } from "@/lib/webhook-verify"

// Reply delivery can legitimately sleep (human-like delays), call the AI provider
// (15s timeout) and then hit the Graph API. Vercel's default function limit is
// shorter than that, so a timed-out invocation could drop a reply mid-send.
export const maxDuration = 60

// Meta signs every webhook POST with HMAC-SHA256 of the raw body. Depending on app setup the
// signing key is the Instagram app secret or the parent Meta app secret, so accept either.
const APP_SECRETS = [process.env.INSTAGRAM_APP_SECRET, process.env.META_APP_SECRET].filter(
  (s): s is string => Boolean(s),
)

function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (APP_SECRETS.length === 0 || !signatureHeader?.startsWith("sha256=")) return false
  const received = signatureHeader.slice("sha256=".length)
  return APP_SECRETS.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
    return (
      received.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"))
    )
  })
}

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
// API: GET https://graph.instagram.com/v21.0/{recipientId}?fields=is_user_follow_business
// Returns:
//   { follows: true, error: undefined }  → confirmed following
//   { follows: false, error: undefined } → confirmed NOT following
//   { follows: null, error: 'auth' } → auth/permission failure (401, 403) — fail CLOSED
//   { follows: null, error: 'transient' } → transient failure (5xx, timeout) — fail OPEN
// ============================================================
async function verifyFollowStatus(igScopedId: string, pageAccessToken: string): Promise<{ follows: boolean | null; error?: 'auth' | 'transient' }> {
  try {
    const url = `https://graph.instagram.com/v21.0/${igScopedId}?fields=is_user_follow_business&access_token=${pageAccessToken}`
    // 5s timeout -- Graph API is fast, anything longer means trouble
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[webhook] Follow status check failed: ${response.status} ${errorText}`)
      // Distinguish auth failures (fail closed) from transient (fail open)
      if (response.status === 401 || response.status === 403) {
        return { follows: null, error: 'auth' }
      }
      // 5xx, 429, network timeout, etc. → transient, fail open
      return { follows: null, error: 'transient' }
    }
    const data = await response.json()
    const follows = data.is_user_follow_business === true
    console.log(`[webhook] Follow check for ${igScopedId}: is_user_follow_business=${data.is_user_follow_business} => ${follows ? "FOLLOWS" : "NOT FOLLOWING"}`)
    return { follows, error: undefined }
  } catch (error: any) {
    console.error("[webhook] Error checking follow status:", error)
    // AbortSignal.timeout throws AbortError/TimeoutError -- both are transient
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return { follows: null, error: 'transient' }
    }
    // Network error → transient, fail open
    return { follows: null, error: 'transient' }
  }
}

// Unlock-attempt counter is in lib/unlock-tracking.ts -- uses Supabase
// unlock_attempts table so the 3-attempt cap works across Vercel instances.

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
    if (!isValidSignature(rawBody, signature)) {
      // Hash prefixes are safe to log and let us tell a wrong secret from a mutated body.
      const computed = APP_SECRETS.map(
        (s, i) =>
          `${i === 0 ? "IG" : "META"}:${crypto.createHmac("sha256", s).update(rawBody, "utf8").digest("hex").slice(0, 12)}`,
      ).join(" ")
      console.error(
        `[webhook] 401: ${!signature ? "no x-hub-signature-256 header" : "signature mismatch"}; ` +
          `secrets configured: ${APP_SECRETS.length}; received=${signature?.slice(7, 19) ?? "-"} computed=[${computed}] bodyLen=${rawBody.length}`,
      )
      if (process.env.DISABLE_WEBHOOK_SIGNATURE_CHECK === "true") {
        console.warn("[webhook] SIGNATURE CHECK BYPASSED — remove DISABLE_WEBHOOK_SIGNATURE_CHECK after debugging")
      } else {
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

      if (!user) {
        const { data: allUsers } = await supabase.from("users").select("*")
        if (allUsers) {
          for (const candidate of allUsers) {
            if (!candidate.access_token) continue
            if (await verifyIdOwnership(candidate.access_token, webhookId)) {
              await supabase.from("users").update({ page_id: webhookId }).eq("id", candidate.id)
              user = candidate
              break
            }
          }
        }
      }

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
                      const followResult = await verifyFollowStatus(senderId, user.access_token)

                      if (followResult.follows === true) {
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
                      } else if (followResult.follows === false) {
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
                        // null → unverifiable. Distinguish auth vs transient.
                        const isAuthError = followResult.error === 'auth'
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

          let match = null
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
                                          console.log(`[webhook] ✨ Story match: "${match.name}"`)
                                          const content = parseContent(match.response_content)

                                          if (content.check_follow === true) {
                                            const followResult = await verifyFollowStatus(senderId, user.access_token)

                                            if (followResult.follows === true) {
                                              console.log(`[webhook] ✅ Story follower gate: @${senderId} follows @${user.username} — sending content`)
                                              await sendAutomationResponse(user.access_token, { id: senderId }, content)
                                            } else if (followResult.follows === false) {
                                              console.log(`[webhook] 🔒 Story follower gate: @${senderId} doesn't follow @${user.username}`)
                                              await sendCardDM(user.access_token, { id: senderId }, buildFollowGateCard({ username: user.username, ruleId: match.id }))
                                            } else {
                                              // null → unverifiable. Distinguish auth vs transient.
                                              const isAuthError = followResult.error === 'auth'
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

          // Inbox bookkeeping runs alongside delivery, not ahead of it. Always
          // joined below so serverless shutdown cannot discard pending writes.
          const incomingSaved = (async () => {
          let conv = null
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
                    let match = null

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
                        const followResult = await verifyFollowStatus(senderId, user.access_token)

                        if (followResult.follows === true) {
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
                        } else if (followResult.follows === false) {
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
                                                  // null → unverifiable. Cap the loop.
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
                                                const followResult = await verifyFollowStatus(senderId, user.access_token)

                                                if (followResult.follows === true) {
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
                        } else if (followResult.follows === false) {
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
                          // null → unverifiable. Distinguish auth vs transient. Auth fail-CLOSED:
                          // send gate, don't deliver content (matches comment/story branches).
                          // Only transient 5xx/timeouts fail OPEN and deliver content.
                          const isAuthError = followResult.error === 'auth'
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
