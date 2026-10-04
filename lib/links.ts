// Tracked short links (/r/<code>) for URLs and files sent in DMs.
// Table: migrations/005_etapa5_arquivos_links.sql.
import { randomBytes } from "crypto"

type Db = any

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g

export function appBaseUrl(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  try {
    return new URL(process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "").origin
  } catch {
    return "http://localhost:3000"
  }
}

function newCode(length = 8): string {
  const bytes = randomBytes(length)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")
}

export interface LinkContext {
  userId: number | string
  automationId?: string | null
  igId?: string | null
}

/** Creates a short link; returns null if it could not be stored. */
export async function createTrackedLink(db: Db, ctx: LinkContext, target: { url?: string; fileId?: string }): Promise<string | null> {
  const automationId = ctx.automationId && /^[0-9a-f-]{36}$/i.test(ctx.automationId) ? ctx.automationId : null
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode()
    const { error } = await db.from("tracked_links").insert({
      code,
      user_id: ctx.userId,
      automation_id: automationId,
      ig_id: ctx.igId || null,
      target_url: target.url || null,
      file_id: target.fileId || null,
    })
    if (!error) return `${appBaseUrl()}/r/${code}`
    if (error.code !== "23505") {
      console.error("[links] createTrackedLink failed:", error.message)
      return null
    }
  }
  return null
}

// Amazon Associates policy (BR, items v/w) forbids redirects or shorteners that hide that the link
// goes to Amazon or obscure where the click came from. Amazon links are sent untouched
// (amzn.to, Amazon's own shortener, is allowed); clicks show up in the Associates reports.
const NEVER_TRACK_HOSTS = /(^|\.)(amazon\.com\.br|amazon\.com|amzn\.to|amzn\.com|a\.co)$/i

export function canTrack(url: string): boolean {
  try {
    return !NEVER_TRACK_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Replaces every http(s) URL in the text with a tracked link (keeps the original if tracking fails). */
export async function trackUrlsInText(db: Db, ctx: LinkContext, text: string): Promise<string> {
  const urls = [...new Set(text.match(URL_IN_TEXT) || [])].filter((u) => !u.startsWith(`${appBaseUrl()}/r/`) && canTrack(u))
  let result = text
  for (const url of urls) {
    const tracked = await createTrackedLink(db, ctx, { url })
    if (tracked) result = result.split(url).join(tracked)
  }
  return result
}

/** Text + tracked file link, as sent in the DM. */
export async function withFileLink(db: Db, ctx: LinkContext, message: string, file: { id?: string; name?: string } | undefined): Promise<string> {
  if (!file?.id) return message
  const link = await createTrackedLink(db, ctx, { fileId: file.id })
  if (!link) return message
  const line = `📎 ${file.name || "Arquivo"}: ${link}`
  return message ? `${message}\n\n${line}` : `Aqui está o seu arquivo!\n\n${line}`
}

/** Card with its web_url buttons replaced by tracked links. */
export async function trackCard(db: Db, ctx: LinkContext, card: any): Promise<any> {
  const buttons = await Promise.all(
    (card?.buttons || []).map(async (b: any) => {
      if (b.type !== "web_url" || !b.url || !canTrack(b.url)) return b
      return { ...b, url: (await createTrackedLink(db, ctx, { url: b.url })) || b.url }
    }),
  )
  return { ...card, buttons }
}
