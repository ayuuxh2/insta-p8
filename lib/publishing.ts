// Instagram content publishing (carousel, photo, Reel, Story) and the DM rule attached to a published post.
// Used by /api/agent/* (immediate publishing) and /api/cron/publish (scheduled queue).
import { describeGraphError } from "@/lib/instagram-api"
import { normalizeTags } from "@/lib/contacts"

const GRAPH = "https://graph.instagram.com/v24.0"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** processed_events key touched by every /api/cron/publish run. */
export const PUBLISH_HEARTBEAT = "heartbeat:cron-publish"

/** Minutes since the publishing queue last ran (null: never). */
export async function minutesSincePublishRun(db: any): Promise<number | null> {
  const { data } = await db.from("processed_events").select("created_at").eq("event_key", PUBLISH_HEARTBEAT).maybeSingle()
  return data?.created_at ? Math.round((Date.now() - Date.parse(data.created_at)) / 60_000) : null
}

export type PostKind = "carousel" | "image" | "reel" | "story"
export const POST_KINDS: PostKind[] = ["carousel", "image", "reel", "story"]
export const isVideo = (pathOrUrl: string) => /\.mp4(\?|$)/i.test(pathOrUrl)

export async function graph(token: string, path: string, init: { method?: string; body?: Record<string, unknown> } = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(describeGraphError(json.error || `HTTP ${res.status}`))
  return json
}

/** FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED */
export async function containerStatus(token: string, containerId: string): Promise<{ status: string; detail?: string }> {
  const { status_code, status } = await graph(token, `${containerId}?fields=status_code,status`)
  return { status: status_code, detail: status }
}

export async function waitFinished(token: string, containerId: string, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const { status, detail } = await containerStatus(token, containerId)
    if (status === "FINISHED") return
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`O Instagram recusou a mídia (${detail || status})`)
    await sleep(2000)
  }
  throw new Error("O Instagram demorou demais para processar a mídia")
}

/**
 * Creates the media container. Photos and carousel items are waited for here (seconds);
 * Reels and video Stories keep processing on Instagram's side and are checked later.
 * trial: Reel de teste (Trial Reel) — shown only to non-followers; Instagram shares it with followers
 * automatically if it performs well (SS_PERFORMANCE).
 */
export async function createContainer(token: string, kind: PostKind, urls: string[], caption: string, coverUrl?: string | null, trial = false): Promise<string> {
  if (!urls.length) throw new Error("Nenhuma mídia")
  if (kind === "reel") {
    const body: Record<string, unknown> = { media_type: "REELS", video_url: urls[0], caption }
    if (trial) body.trial_params = { graduation_strategy: "SS_PERFORMANCE" }
    else body.share_to_feed = true
    if (coverUrl) body.cover_url = coverUrl
    return (await graph(token, "me/media", { method: "POST", body })).id
  }
  if (kind === "story") {
    const body = isVideo(urls[0]) ? { media_type: "STORIES", video_url: urls[0] } : { media_type: "STORIES", image_url: urls[0] }
    return (await graph(token, "me/media", { method: "POST", body })).id
  }
  if (kind === "image" || urls.length === 1) {
    return (await graph(token, "me/media", { method: "POST", body: { image_url: urls[0], caption } })).id
  }
  const children: string[] = []
  for (const url of urls) {
    const body = isVideo(url) ? { media_type: "VIDEO", video_url: url, is_carousel_item: true } : { image_url: url, is_carousel_item: true }
    children.push((await graph(token, "me/media", { method: "POST", body })).id)
  }
  for (const child of children) await waitFinished(token, child, 30)
  return (await graph(token, "me/media", { method: "POST", body: { media_type: "CAROUSEL", children: children.join(","), caption } })).id
}

/** Carousel items, created without waiting (videos can take minutes to process). */
export async function createCarouselChildren(token: string, urls: string[]): Promise<string[]> {
  if (urls.length < 2 || urls.length > 10) throw new Error("Carrossel precisa de 2 a 10 itens")
  const children: string[] = []
  for (const url of urls) {
    const body = isVideo(url) ? { media_type: "VIDEO", video_url: url, is_carousel_item: true } : { image_url: url, is_carousel_item: true }
    children.push((await graph(token, "me/media", { method: "POST", body })).id)
  }
  return children
}

export async function createCarouselParent(token: string, children: string[], caption: string): Promise<string> {
  return (await graph(token, "me/media", { method: "POST", body: { media_type: "CAROUSEL", children: children.join(","), caption } })).id
}

/** container_id while carousel items are still processing: "children:<id>,<id>…" */
export const CHILDREN_PREFIX = "children:"

export async function publishContainer(token: string, creationId: string): Promise<{ mediaId: string; permalink: string | null }> {
  const { id: mediaId } = await graph(token, "me/media_publish", { method: "POST", body: { creation_id: creationId } })
  let permalink: string | null = null
  try {
    permalink = (await graph(token, `${mediaId}?fields=permalink`)).permalink || null
  } catch {
    // Stories may not expose a permalink; the post is published anyway.
  }
  return { mediaId, permalink }
}

// ---------- Rule attached to a published post ----------

const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const strList = (v: unknown, max = 10) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : [])

/** Validates the rule body; returns an error message or null. */
export function ruleProblem(body: any): string | null {
  const keywords = strList(body?.keywords, 5)
  if ((!keywords.length && body?.anyComment !== true) || !str(body?.message, 950)) return "Informe keywords (ou anyComment) e message"
  const link = str(body?.link, 500)
  if (link && !/^https?:\/\//i.test(link)) return "Link inválido"
  return null
}

/**
 * Creates the rule for a published post: comments on a feed post/Reel, or replies to a Story.
 * { name, keywords[], message, messageVariants?, link?, checkFollow?, publicReplies?, tags?,
 *   optinTitle?, optinSubtitle?, optinButton?, replyMode?, anyComment? }
 */
export async function createPostRule(db: any, userId: number | string, mediaId: string, body: any, source: "comment" | "story" = "comment") {
  const problem = ruleProblem(body)
  if (problem) throw new Error(problem)
  const keywords = strList(body.keywords, 5).map((k) => k.toLowerCase().replace(/,/g, " "))
  const link = str(body.link, 500)
  const anyComment = body.anyComment === true

  // The link goes at the end of every message variation (tracked automatically when sent).
  const withLink = (text: string) => (link && !text.includes(link) ? `${text}\n\n👉 ${link}` : text)
  const replyMode = ["both", "dm_only", "public_only"].includes(body.replyMode) ? body.replyMode : "both"
  const content: Record<string, unknown> = {
    message: withLink(str(body.message, 950)),
    check_follow: body.checkFollow !== false,
    // Story replies are private already: there is no public reply.
    reply_mode: source === "story" ? "dm_only" : replyMode,
  }
  const variants = strList(body.messageVariants, 5).map(withLink)
  if (variants.length) content.message_variants = variants
  const publicReplies = strList(body.publicReplies, 8)
  if (publicReplies.length && source === "comment") content.public_replies = publicReplies
  const tags = normalizeTags(body.tags)
  if (tags.length) content.add_tags = tags
  for (const [key, field, max] of [["optinTitle", "optin_title", 80], ["optinSubtitle", "optin_subtitle", 80], ["optinButton", "optin_button", 20]] as const) {
    const value = str(body[key], max)
    if (value) content[field] = value
  }

  const trigger =
    source === "story"
      ? { trigger_source: "story", trigger_type: "reply", trigger_value: anyComment ? "ALL" : keywords.join(", ") }
      : { trigger_source: "comment", trigger_type: anyComment ? "reply_all" : "keyword", trigger_value: anyComment ? "ALL_COMMENTS" : keywords.join(", ") }

  const { data, error } = await db
    .from("automations")
    .insert({
      user_id: userId,
      name: str(body.name, 120) || `${source === "story" ? "Story" : "Post"}: ${anyComment ? "todas as respostas" : keywords[0]}`,
      ...trigger,
      response_type: "pro",
      response_content: content,
      is_active: true,
      specific_media_id: String(mediaId),
    })
    .select("id, name, trigger_value, specific_media_id")
    .single()
  if (error) throw new Error(`Não foi possível criar a regra: ${error.message}`)
  return data as { id: string; name: string; trigger_value: string; specific_media_id: string }
}
