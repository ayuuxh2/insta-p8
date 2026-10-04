import crypto from "crypto"
import { after, type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import {
  sendTextDM,
  sendCardDM,
  sendMediaDM,
  sendSenderAction,
  replyToComment,
  fetchProfile,
  verifyIdOwnership,
  buildFollowGateCard,
  buildOptInCard,
  checkFollowsBusiness,
  OPTIN_PAYLOAD_PREFIX,
  UNLOCK_PAYLOAD_PREFIX,
  describeGraphError,
  type SendResult,
} from "@/lib/instagram-api"
import { generateAIReply } from "@/lib/ai-reply"
import { bumpUnlockAttempt, clearUnlockAttempts, unlockKey } from "@/lib/unlock-tracking"
import {
  claimEvent,
  logSend,
  countSendsLastHour,
  touchContact,
  setOptOut,
  optCommand,
  pickMessage,
  humanDelayMs,
  wait,
  PRIVATE_REPLY_HOURLY_LIMIT,
  OPT_OUT_CONFIRMATION,
  OPT_IN_CONFIRMATION,
} from "@/lib/antispam"
import { recordEvent, setFollows, addTags, setUsernameIfMissing, deleteContactData, isDeleteRequest, DELETE_CONFIRMATION } from "@/lib/contacts"
import { trackUrlsInText, withFileLink, trackCard } from "@/lib/links"
import { classifyGraphError, HEALTH_TEXT } from "@/lib/health"
import { sendAlert } from "@/lib/notify"

// Work continues after the 200 response (see after()); give it room for human-like delays.
export const maxDuration = 60

type Db = any
type Recipient = { id?: string; comment_id?: string }

// Trim: values pasted into the Vercel dashboard often carry stray whitespace.
const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim()
// Meta signs every webhook POST with HMAC-SHA256 of the raw body. Depending on app setup the
// signing key is the Instagram app secret or the parent Meta app secret, so accept either.
const APP_SECRETS = [process.env.INSTAGRAM_APP_SECRET?.trim(), process.env.META_APP_SECRET?.trim()].filter(
  (s): s is string => Boolean(s),
)

const DEFAULT_PUBLIC_REPLIES = ["Te mandei no direct! 📩", "Enviado na sua DM! 🔥", "Confere seu direct! ✨", "Já te chamei no direct 😉"]

// Max gate cards for an unverifiable follow status before we send one "couldn't verify" message.
const UNLOCK_GATE_MAX_ATTEMPTS = 3
// Queued private replies drained per webhook call.
const PENDING_DRAIN_BATCH = 10
// Private replies are only accepted up to 7 days after the comment.
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3_600_000

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && WEBHOOK_VERIFY_TOKEN && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Token inválido" }, { status: 403 })
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: true })
  }

  // Answer Meta right away (slow answers make Meta retry) and do the work afterwards.
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error("[webhook] Error", error)
    }
  })
  return NextResponse.json({ ok: true })
}

// ============================================================
// Helpers
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

/** The first keyword of the rule found in the text, or null. */
function matchedKeyword(triggerValue: string, text: string): string | null {
  return (
    triggerValue
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean)
      .find((k: string) => {
        try {
          return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
        } catch {
          return text.includes(k.toLowerCase())
        }
      }) || null
  )
}

function keywordMatches(triggerValue: string, text: string): boolean {
  return matchedKeyword(triggerValue, text) !== null
}

/** Sends the rule content and records "content_sent" for the contact. */
async function deliver(db: Db, user: any, senderId: string, rule: any, content: any): Promise<string | null> {
  const preview = await sendRuleContent(db, user, senderId, rule, content)
  if (preview) await recordEvent(db, user.id, senderId, "content_sent", { automationId: rule.id })
  return preview
}

function responsePreviewText(content: any, message?: string): string {
  if (message) return message
  if (content.message) return content.message
  if (content.card) return `[Cartão] ${content.card.title}`
  if (content.media?.url) return `[${content.media.type || "media"}]`
  return "[automação]"
}

/**
 * Wraps a send so successful ones are counted for the hourly limits. The last failure is kept
 * on the per-entry user object so the event log can show what Instagram answered.
 */
async function tracked(db: Db, user: any, recipient: Recipient, send: Promise<SendResult>): Promise<SendResult> {
  const result = await send
  if (result?.ok) await logSend(db, user.id, recipient.comment_id ? "private_reply" : "dm")
  else await onSendError(db, user, result?.error)
  return result
}

/** Keeps the error for the event log and alerts the owner right away if access is down. */
async function onSendError(db: Db, user: any, error: any) {
  user.lastSendError = describeGraphError(error)
  const health = classifyGraphError(error)
  if (!health.ok && health.reason) {
    const text = HEALTH_TEXT[health.reason]
    await sendAlert(db, `health:${user.id}:${health.reason}`, text.title, `@${user.username}: ${text.action}\n\nDetalhe da Meta: ${health.message || health.reason}`)
  }
}

/** Outcome for the event log, including Instagram's error when a send failed. */
function sendOutcome(user: any, ok: boolean, success: string): string {
  if (ok) return success
  const error = user.lastSendError
  user.lastSendError = undefined
  return `falha no envio${error ? `: ${error}` : ""}`
}

/** One row per received comment/message in webhook_events (Preferências → Diagnóstico). */
async function logWebhook(db: Db, userId: number | string, type: string, data: Record<string, unknown>) {
  const { error } = await db.from("webhook_events").insert({ event_type: type, user_id: userId, data })
  if (error) console.error("[webhook] event log failed:", error.message)
}

/**
 * Sends a rule's content in the DM (24h window open): text with variations, card, or media
 * followed by text. Waits a human-like random delay first, optionally showing "typing...".
 * Returns the inbox preview, or null if nothing was sent.
 */
/** Picks the message (or a variation), appends the file link and swaps URLs for tracked links. */
async function buildMessage(db: Db, user: any, rule: any, recipientId: string, content: any): Promise<string> {
  const ctx = { userId: user.id, automationId: rule?.id, igId: recipientId }
  const text = await withFileLink(db, ctx, pickMessage(content), content.file)
  return text ? trackUrlsInText(db, ctx, text) : ""
}

async function sendRuleContent(db: Db, user: any, recipientId: string, rule: any, content: any): Promise<string | null> {
  const token = user.access_token
  const recipient = { id: recipientId }
  const useTyping = content.typing_indicator === true

  if (useTyping) await sendSenderAction(token, recipientId, "typing_on")
  await wait(humanDelayMs(content))

  const quickReplies = Array.isArray(content.quick_replies)
    ? content.quick_replies
        .filter((q: any) => q?.title)
        .map((q: any) => ({ title: q.title, payload: q.payload || `QR_${q.title.toUpperCase().replace(/\s+/g, "_")}` }))
    : undefined
  const message = await buildMessage(db, user, rule, recipientId, content)

  let result: SendResult
  if (content.media?.url) {
    result = await tracked(db, user, recipient, sendMediaDM(token, recipient, content.media.type || "image", content.media.url))
    if (result.ok && message) {
      result = await tracked(db, user, recipient, sendTextDM(token, recipient, message, quickReplies))
    }
  } else if (content.card) {
    const card = await trackCard(db, { userId: user.id, automationId: rule?.id, igId: recipientId }, content.card)
    result = await tracked(db, user, recipient, sendCardDM(token, recipient, card))
  } else if (message) {
    result = await tracked(db, user, recipient, sendTextDM(token, recipient, message, quickReplies))
  } else {
    result = { ok: false, error: "empty content" }
  }

  if (useTyping) await sendSenderAction(token, recipientId, "typing_off")
  return result.ok ? responsePreviewText(content, message) : null
}

/**
 * Private reply to a comment. Instagram accepts ONE message per comment, so:
 *  - default / follow-gated: a card with the "Quero receber" button (tap opens the DM
 *    window; the rule content goes out after the tap, see handleMessagingEvent);
 *  - "direct_send": a single message (card, or text, or media — never two).
 */
async function sendPrivateReply(db: Db, user: any, rule: any, content: any, commentId: string, senderId: string): Promise<SendResult> {
  const token = user.access_token
  const recipient = { comment_id: commentId }
  await wait(humanDelayMs(content))

  if (content.direct_send === true && content.check_follow !== true) {
    const message = await buildMessage(db, user, rule, senderId, content)
    if (content.card) {
      const card = await trackCard(db, { userId: user.id, automationId: rule.id, igId: senderId }, content.card)
      return tracked(db, user, recipient, sendCardDM(token, recipient, card))
    }
    if (message) return tracked(db, user, recipient, sendTextDM(token, recipient, message))
    if (content.media?.url) return tracked(db, user, recipient, sendMediaDM(token, recipient, content.media.type || "image", content.media.url))
    return { ok: false, error: "empty content" }
  }

  return tracked(
    db,
    user,
    recipient,
    sendCardDM(
      token,
      recipient,
      buildOptInCard({
        ruleId: rule.id,
        title: content.optin_title,
        subtitle: content.optin_subtitle,
        buttonTitle: content.optin_button,
      }),
    ),
  )
}

async function sendPublicReply(db: Db, user: any, content: any, commentId: string): Promise<boolean> {
  const pool: string[] =
    Array.isArray(content.public_replies) && content.public_replies.filter(Boolean).length > 0
      ? content.public_replies.filter(Boolean)
      : DEFAULT_PUBLIC_REPLIES
  const result = await replyToComment(user.access_token, commentId, pickRandom(pool))
  if (result.ok) await logSend(db, user.id, "public_reply")
  else await onSendError(db, user, result.error)
  return result.ok
}

// ============================================================
// Follow gate. Only runs once the person has interacted in the DM (button tap,
// message, story reply): Instagram only exposes is_user_follow_business then.
//   follows      → deliver the rule's content
//   not follows  → gate card ("Seguir" + "Já segui ✅" re-check)
//   unknown      → gate card as well (fail CLOSED); after N unverifiable
//                  re-checks, one "couldn't verify" message, then stop.
// Returns the inbox preview of what was sent, or null if nothing was sent.
// ============================================================
async function runFollowGate(db: Db, user: any, senderId: string, rule: any, content: any, isRecheck: boolean): Promise<string | null> {
  const token = user.access_token
  const recipient = { id: senderId }
  const attemptKey = unlockKey(senderId, rule.id)
  const follows = await checkFollowsBusiness(token, senderId)
  console.log(`[webhook] Follow gate for ${senderId} / rule ${rule.id}: follows=${follows}${isRecheck ? " (re-check)" : ""}`)
  if (follows !== null) await setFollows(db, user.id, senderId, follows)

  if (follows === true) {
    await clearUnlockAttempts(attemptKey)
    return deliver(db, user, senderId, rule, content)
  }

  await wait(humanDelayMs({}))
  if (follows === false) {
    await clearUnlockAttempts(attemptKey)
    const card = isRecheck
      ? buildFollowGateCard({
          username: user.username,
          ruleId: rule.id,
          title: "Ainda não encontramos seu follow 🤔",
          subtitle: `Siga a @${user.username} e toque em "Já segui" de novo.`,
        })
      : buildFollowGateCard({ username: user.username, ruleId: rule.id })
    const result = await tracked(db, user, recipient, sendCardDM(token, recipient, card))
    if (result.ok) await recordEvent(db, user.id, senderId, "gate_sent", { automationId: rule.id })
    return result.ok ? "[Pediu para seguir]" : null
  }

  const attempts = await bumpUnlockAttempt(attemptKey)
  if (attempts > UNLOCK_GATE_MAX_ATTEMPTS) {
    await clearUnlockAttempts(attemptKey)
    console.warn(`[webhook] Follow gate capped after ${attempts} unverifiable attempts for ${senderId} / rule ${rule.id}`)
    const result = await tracked(
      db,
      user,
      recipient,
      sendTextDM(token, recipient, "Não conseguimos confirmar seu follow agora. Tente de novo em alguns minutos 🙏"),
    )
    return result.ok ? "[Verificação indisponível — limite atingido]" : null
  }
  const result = await tracked(db, user, recipient, sendCardDM(token, recipient, buildFollowGateCard({ username: user.username, ruleId: rule.id })))
  if (result.ok) await recordEvent(db, user.id, senderId, "gate_sent", { automationId: rule.id })
  return result.ok ? `[Pediu para seguir — verificação indisponível ${attempts}/${UNLOCK_GATE_MAX_ATTEMPTS}]` : null
}

// ============================================================
// Inbox bookkeeping
// ============================================================

async function ensureConversation(db: Db, user: any, senderId: string): Promise<{ id: string; recipient_username?: string } | null> {
  try {
    const { data: existing } = await db
      .from("conversations")
      .select("id, recipient_username")
      .eq("user_id", user.id)
      .eq("recipient_id", senderId)
      .maybeSingle()
    if (existing) {
      await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", existing.id)
      return existing
    }
    const profile = await fetchProfile(user.access_token, senderId)
    const { data: created } = await db
      .from("conversations")
      .insert({
        user_id: user.id,
        recipient_id: senderId,
        recipient_username: profile?.username || `cnt_${senderId.slice(0, 5)}...`,
        last_message_at: new Date().toISOString(),
      })
      .select("id, recipient_username")
      .single()
    return created
  } catch (err) {
    console.error("[webhook] Failed to save conversation", err)
    return null
  }
}

async function saveMessage(db: Db, user: any, conv: { id: string } | null, fromCustomer: boolean, senderId: string, content: string, mid?: string) {
  if (!conv) return
  const { error } = await db.from("messages").insert({
    id: mid || `mid_${fromCustomer ? "in" : "out"}_${Date.now()}_${Math.random()}`,
    conversation_id: conv.id,
    user_id: user.id,
    sender_id: fromCustomer ? senderId : user.business_account_id,
    sender_username: fromCustomer ? "User" : user.username,
    content,
    is_from_instagram: fromCustomer,
  })
  if (error && error.code !== "23505") console.error("[webhook] Failed to save message", error.message)
}

// ============================================================
// Main processing
// ============================================================

async function resolveUser(db: Db, entry: any): Promise<any | null> {
  const webhookId = String(entry.id)
  const { data: user } = await db
    .from("users")
    .select("*")
    .or(`business_account_id.eq.${webhookId},page_id.eq.${webhookId}`)
    .maybeSingle()
  if (user) return user

  const candidateIds = new Set<string>()
  for (const change of entry.changes || []) {
    if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
  }
  for (const event of entry.messaging || []) {
    if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
  }
  for (const candidateId of candidateIds) {
    if (candidateId === webhookId) continue
    const { data: fallbackUser } = await db
      .from("users")
      .select("*")
      .or(`business_account_id.eq.${candidateId},page_id.eq.${candidateId}`)
      .maybeSingle()
    if (fallbackUser) {
      await db.from("users").update({ page_id: webhookId }).eq("id", fallbackUser.id)
      return fallbackUser
    }
  }

  const { data: allUsers } = await db.from("users").select("*")
  for (const candidate of allUsers || []) {
    if (candidate.access_token && (await verifyIdOwnership(candidate.access_token, webhookId))) {
      await db.from("users").update({ page_id: webhookId }).eq("id", candidate.id)
      return candidate
    }
  }
  return null
}

async function processWebhook(body: any) {
  if (!body?.entry) return
  const db = await getSupabaseServerClient()

  for (const entry of body.entry) {
    if (entry.messaging?.every((e: any) => e.read || e.delivery || e.message?.is_echo)) continue

    const user = await resolveUser(db, entry)
    if (!user) {
      console.log(`[webhook] Could not resolve user for ID ${entry.id}`)
      continue
    }
    const ownIds = new Set([String(entry.id), String(user.business_account_id), String(user.page_id)])

    const { data: automations } = await db.from("automations").select("*").eq("user_id", user.id).eq("is_active", true)
    const rules: any[] = automations || []

    await drainPendingReplies(db, user, rules)

    for (const change of entry.changes || []) {
      if (change.field !== "comments" || !change.value?.text) continue
      const value = change.value
      let outcome: string
      user.lastSendError = undefined
      try {
        outcome = await handleComment(db, user, rules, value, ownIds)
      } catch (e: any) {
        console.error("[webhook] comment error", e)
        outcome = `erro interno: ${e?.message || e}`
      }
      if (outcome !== "própria conta") {
        await logWebhook(db, user.id, "comentário", {
          ig: String(value.from?.id || ""),
          de: value.from?.username ? `@${value.from.username}` : value.from?.id,
          texto: String(value.text).slice(0, 80),
          resultado: outcome,
        })
      }
    }

    for (const event of entry.messaging || []) {
      if (event.read || event.delivery || event.message?.is_echo) continue
      const senderId = String(event.sender?.id || "")
      if (!senderId || ownIds.has(senderId)) continue
      let outcome: string
      user.lastSendError = undefined
      try {
        outcome = await handleMessagingEvent(db, user, rules, event, senderId)
      } catch (e: any) {
        console.error("[webhook] messaging error", e)
        outcome = `erro interno: ${e?.message || e}`
      }
      // An erasure request is logged without anything that identifies the person.
      const erased = !!event.message?.text && isDeleteRequest(event.message.text)
      await logWebhook(db, user.id, messagingType(event), {
        ig: erased ? null : senderId,
        de: erased ? "(dados excluídos)" : senderId,
        texto: erased ? "EXCLUIR MEUS DADOS" : String(event.message?.text || event.postback?.title || event.reaction?.emoji || "").slice(0, 80),
        resultado: outcome,
      })
    }
  }
}

function messagingType(event: any): string {
  if (event.postback || event.message?.quick_reply) return "botão"
  if (event.reaction) return "reação"
  if (event.message?.reply_to?.story || event.message?.attachments?.[0]?.type === "story_mention") return "story"
  return "DM"
}

// ---------- Comments ----------

async function handleComment(db: Db, user: any, rules: any[], value: any, ownIds: Set<string>): Promise<string> {
  const commentId = String(value.id)
  const senderId = String(value.from?.id || "")
  if (!senderId || ownIds.has(senderId)) return "própria conta"

  const commentText = String(value.text).toLowerCase().trim()
  const mediaId = value.media?.id
  const commentRules = rules.filter((a) => a.trigger_source === "comment")

  // Priority: specific post reply-all → specific post keyword → global keyword
  const match =
    commentRules.find((a) => a.specific_media_id === mediaId && a.trigger_type === "reply_all") ||
    commentRules.find((a) => a.specific_media_id === mediaId && a.trigger_type === "keyword" && keywordMatches(a.trigger_value, commentText)) ||
    commentRules.find((a) => !a.specific_media_id && a.trigger_type === "keyword" && keywordMatches(a.trigger_value, commentText))
  if (!match) return "nenhuma regra correspondente"

  const content = parseContent(match.response_content)
  if (value.parent_id && content.include_replies !== true) return `resposta a comentário ignorada ("${match.name}")`
  if (!(await claimEvent(db, `comment:${commentId}`))) {
    console.log(`[webhook] Comment ${commentId} already handled — skipping`)
    return "duplicado (já respondido)"
  }
  console.log(`[webhook] Comment match: "${match.name}"`)

  const { optedOut } = await touchContact(db, user.id, senderId, value.from?.username)
  await recordEvent(db, user.id, senderId, "comment", {
    automationId: match.id,
    keyword: match.trigger_type === "keyword" ? matchedKeyword(match.trigger_value, commentText) : null,
    mediaId,
  })
  await addTags(db, user.id, senderId, content.add_tags)
  const replyMode = content.reply_mode || "both"

  const publicOk = replyMode !== "dm_only" ? await sendPublicReply(db, user, content, commentId) : true
  const publicNote = publicOk ? "" : " · resposta pública falhou"
  if (replyMode === "public_only") return sendOutcome(user, publicOk, `"${match.name}": só resposta pública`)
  if (optedOut) {
    console.log(`[webhook] ${senderId} opted out — no private reply`)
    return `"${match.name}": pessoa saiu da lista, DM não enviada${publicNote}`
  }

  if ((await countSendsLastHour(db, user.id, "private_reply")) >= PRIVATE_REPLY_HOURLY_LIMIT) {
    console.warn(`[webhook] Hourly private reply limit reached — queueing comment ${commentId}`)
    await db.from("pending_replies").insert({
      user_id: user.id,
      automation_id: match.id,
      comment_id: commentId,
      sender_id: senderId,
      comment_created_at: value.timestamp ? new Date(Number(value.timestamp) * 1000).toISOString() : new Date().toISOString(),
    })
    return `"${match.name}": na fila (limite por hora atingido)${publicNote}`
  }
  const result = await privateReplyAndRecord(db, user, match, content, commentId, senderId)
  const direct = content.direct_send === true && content.check_follow !== true
  return sendOutcome(user, result.ok, `"${match.name}": ${direct ? "conteúdo enviado na DM" : 'cartão "Quero receber" enviado'}${publicNote}`)
}

async function privateReplyAndRecord(db: Db, user: any, rule: any, content: any, commentId: string, senderId: string): Promise<SendResult> {
  const result = await sendPrivateReply(db, user, rule, content, commentId, senderId)
  if (result.ok) {
    const direct = content.direct_send === true && content.check_follow !== true
    await recordEvent(db, user.id, senderId, direct ? "content_sent" : "optin_sent", { automationId: rule.id })
  }
  return result
}

/** Sends queued private replies while the hourly limit allows (oldest first, within 7 days). */
async function drainPendingReplies(db: Db, user: any, rules: any[]) {
  const { data: pending } = await db
    .from("pending_replies")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(PENDING_DRAIN_BATCH)
  if (!pending?.length) return

  let sent = await countSendsLastHour(db, user.id, "private_reply")
  for (const item of pending) {
    const expired = Date.now() - new Date(item.comment_created_at).getTime() > PRIVATE_REPLY_WINDOW_MS - 3_600_000
    const rule = rules.find((r) => r.id === item.automation_id)
    if (expired || !rule) {
      await db.from("pending_replies").delete().eq("id", item.id)
      continue
    }
    if (sent >= PRIVATE_REPLY_HOURLY_LIMIT) return
    const result = await privateReplyAndRecord(db, user, rule, parseContent(rule.response_content), item.comment_id, item.sender_id)
    if (result.ok || item.attempts >= 2) {
      await db.from("pending_replies").delete().eq("id", item.id)
    } else {
      await db.from("pending_replies").update({ attempts: item.attempts + 1 }).eq("id", item.id)
    }
    if (result.ok) sent++
  }
}

// ---------- DMs, button taps and stories ----------

function storyMatch(rules: any[], event: any): any | null {
  const storyRules = rules.filter((a) => a.trigger_source === "story")
  if (!storyRules.length) return null
  const isAll = (a: any) => {
    const first = (a.trigger_value || "").split(",")[0]?.trim()
    return !first || ["ALL", "ALL_MENTIONS", "ALL_REACTIONS"].includes(first)
  }

  if (event.message?.attachments?.[0]?.type === "story_mention") {
    const storyId = event.message.attachments[0].payload?.url || null
    return storyRules.find((a) => a.trigger_type === "mention" && (!a.specific_media_id || a.specific_media_id === storyId)) || null
  }
  if (event.reaction) {
    const emoji = event.reaction.emoji
    return (
      storyRules.find((a) => {
        if (a.trigger_type !== "reaction") return false
        if (a.specific_media_id && a.specific_media_id !== event.reaction.mid) return false
        return isAll(a) || a.trigger_value.split(",").map((t: string) => t.trim()).includes(emoji)
      }) || null
    )
  }
  if (event.message?.reply_to?.story) {
    const storyId = event.message.reply_to.story.id || null
    const text = event.message.text || ""
    return (
      storyRules.find((a) => {
        if (a.trigger_type !== "reply") return false
        if (a.specific_media_id && a.specific_media_id !== storyId) return false
        return isAll(a) || keywordMatches(a.trigger_value, text)
      }) || null
    )
  }
  return null
}

async function handleMessagingEvent(db: Db, user: any, rules: any[], event: any, senderId: string): Promise<string> {
  const mid: string | undefined = event.message?.mid || event.postback?.mid || event.reaction?.mid
  const eventKey = mid ? `msg:${mid}${event.reaction ? `:reaction:${event.reaction.action || ""}` : ""}` : null
  if (eventKey && !(await claimEvent(db, eventKey))) {
    console.log(`[webhook] Event ${eventKey} already handled — skipping`)
    return "duplicado (já respondido)"
  }

  // "EXCLUIR MEUS DADOS" (LGPD): erase everything about this person, confirm, keep nothing.
  if (event.message?.text && isDeleteRequest(event.message.text)) {
    await deleteContactData(db, user.id, senderId)
    const result = await tracked(db, user, { id: senderId }, sendTextDM(user.access_token, { id: senderId }, DELETE_CONFIRMATION))
    return sendOutcome(user, result.ok, "pedido de exclusão de dados atendido")
  }

  const { optedOut } = await touchContact(db, user.id, senderId)

  // Story mention / reaction / reply → story rules. A story reply with text is not
  // processed again as a DM keyword (it used to answer twice).
  const story = storyMatch(rules, event)
  if (story) {
    await recordEvent(db, user.id, senderId, "story", { automationId: story.id })
    if (optedOut) return `"${story.name}": pessoa saiu da lista, sem resposta`
    console.log(`[webhook] Story match: "${story.name}"`)
    const content = parseContent(story.response_content)
    await addTags(db, user.id, senderId, content.add_tags)
    const preview =
      content.check_follow === true ? await runFollowGate(db, user, senderId, story, content, false) : await deliver(db, user, senderId, story, content)
    return sendOutcome(user, !!preview, `"${story.name}": ${preview}`)
  }
  if (event.reaction || event.message?.reply_to?.story) return "nenhuma regra de Story correspondente"

  let triggerType: "postback" | "keyword"
  let triggerValue: string
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
    return "mensagem sem texto (foto, áudio…): ignorada"
  }
  console.log(`[webhook] DM from ${senderId}: "${triggerValue}"`)

  const isOptInEvent = triggerType === "postback" && triggerValue.startsWith(OPTIN_PAYLOAD_PREFIX)
  const isUnlockEvent = triggerType === "postback" && triggerValue.startsWith(UNLOCK_PAYLOAD_PREFIX)

  const conv = await ensureConversation(db, user, senderId)
  await setUsernameIfMissing(db, user.id, senderId, conv?.recipient_username)
  await saveMessage(
    db,
    user,
    conv,
    true,
    senderId,
    isOptInEvent ? '[Tocou em "Quero receber"]' : isUnlockEvent ? '[Tocou em "Já segui"]' : event.message?.text || triggerValue,
    event.message?.mid,
  )
  const reply = async (preview: string | null) => {
    if (preview) await saveMessage(db, user, conv, false, senderId, preview)
  }

  // SAIR / VOLTAR
  if (triggerType === "keyword") {
    const command = optCommand(triggerValue)
    if (command) {
      await setOptOut(db, user.id, senderId, command === "out")
      await recordEvent(db, user.id, senderId, command === "out" ? "opt_out" : "opt_in")
      const text = command === "out" ? OPT_OUT_CONFIRMATION : OPT_IN_CONFIRMATION
      const result = await tracked(db, user, { id: senderId }, sendTextDM(user.access_token, { id: senderId }, text))
      await reply(result.ok ? text : null)
      return sendOutcome(user, result.ok, command === "out" ? "saiu da lista (SAIR)" : "voltou para a lista (VOLTAR)")
    }
    // People who opted out only get messages they explicitly ask for by tapping a button.
    if (optedOut) return "pessoa saiu da lista: sem resposta automática"
  }

  // ---------- Match automation ----------
  let match: any = null
  if (triggerType === "postback") {
    if (isOptInEvent || isUnlockEvent) {
      const ruleId = triggerValue.slice((isOptInEvent ? OPTIN_PAYLOAD_PREFIX : UNLOCK_PAYLOAD_PREFIX).length)
      match = rules.find((a) => a.id === ruleId)
    } else if (triggerValue.startsWith("ICE_BREAKER_")) {
      const { data: ib } = await db
        .from("ice_breakers")
        .select("*")
        .eq("id", triggerValue.replace("ICE_BREAKER_", ""))
        .eq("user_id", user.id)
        .maybeSingle()
      if (ib) match = { id: `ice_${ib.id}`, name: "Ice Breaker: " + ib.question, response_content: { message: ib.response } }
    } else {
      match =
        rules.find((a) => a.trigger_type === "postback" && a.trigger_value === triggerValue) ||
        rules.find((a) => (a.trigger_source === "dm" || !a.trigger_source) && a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue.toLowerCase()))
    }
  } else {
    match = rules.find((a) => (a.trigger_source === "dm" || !a.trigger_source) && a.trigger_type === "keyword" && keywordMatches(a.trigger_value, triggerValue))
  }

  await recordEvent(db, user.id, senderId, isOptInEvent ? "optin_tap" : isUnlockEvent ? "unlock_tap" : "dm", {
    automationId: match?.id,
    keyword: match && triggerType === "keyword" ? matchedKeyword(match.trigger_value || "", triggerValue) : null,
  })

  if (!match) {
    if (isOptInEvent || isUnlockEvent) return "botão de uma regra pausada ou excluída: sem resposta"
    if (triggerType === "keyword" && user.groq_auto_reply_enabled) {
      const ok = await aiFallback(db, user, senderId, triggerValue, conv)
      return sendOutcome(user, ok, "sem regra: respondido pela IA")
    }
    return "nenhuma regra correspondente"
  }

  console.log(`[webhook] DM match: "${match.name}"`)
  const content = parseContent(match.response_content)
  await addTags(db, user.id, senderId, content.add_tags)
  if (content.mark_seen !== false) await sendSenderAction(user.access_token, senderId, "mark_seen")

  // Postbacks, messages and story replies are DM interactions, so the follow check is valid here.
  const preview =
    content.check_follow === true
      ? await runFollowGate(db, user, senderId, match, content, isUnlockEvent)
      : await deliver(db, user, senderId, match, content)
  await reply(preview)
  return sendOutcome(user, !!preview, `"${match.name}": ${preview && preview.startsWith("[") ? preview : "conteúdo enviado"}`)
}

async function aiFallback(db: Db, user: any, senderId: string, text: string, conv: { id: string } | null): Promise<boolean> {
  console.log(`[webhook] No rule match — trying AI auto-reply for DM from ${senderId}`)
  await sendSenderAction(user.access_token, senderId, "mark_seen")
  const { data: recentMessages } = conv
    ? await db
        .from("messages")
        .select("content, is_from_instagram")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] }
  const history = (recentMessages || []).reverse().map((message: any) => ({
    role: message.is_from_instagram ? ("user" as const) : ("assistant" as const),
    content: message.content,
  }))
  const aiReply = await generateAIReply(text, user.ai_context || "", history, user.groq_api_key, user.ai_base_url, user.ai_model)
  if (!aiReply) {
    user.lastSendError = "a IA não gerou resposta"
    return false
  }
  await sendSenderAction(user.access_token, senderId, "typing_on")
  await wait(humanDelayMs({}))
  const result = await tracked(db, user, { id: senderId }, sendTextDM(user.access_token, { id: senderId }, aiReply))
  if (result.ok) await saveMessage(db, user, conv, false, senderId, aiReply)
  return result.ok
}
