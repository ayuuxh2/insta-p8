// Vitrine (link da bio): public page /links grouping the products advertised on Instagram.
// Stored as one JSON file in the private bucket (small list, single owner — no table needed):
//   <userId>/vitrine/vitrine.json
// Each product gets a stable number ("procure o nº 12 no link da bio"). Clicks go through a tracked
// short link (/r/<code>), except Amazon affiliate links, which must go straight to Amazon.
import { FILES_BUCKET } from "@/lib/files"
import { canTrack, createTrackedLink } from "@/lib/links"

type Db = any

export type VitrineItem = {
  number: number
  title: string
  category: string
  emoji?: string
  link: string
  /** Code of the tracked /r/ link used on the page (null for links that must not be tracked). */
  shortCode: string | null
  /** Storage path of the product image (inside the private bucket). */
  imagePath?: string | null
  hidden?: boolean
  /** Waiting for its first post: stays off the page until a post with its link is published. */
  pending?: boolean
  affiliate?: boolean
  createdAt: string
  updatedAt: string
}

export type Vitrine = { items: VitrineItem[] }

export const CATEGORY_ORDER = ["Brinquedos", "Ferramentas", "Casa", "Cozinha", "Carro", "Outros"]

const fileOf = (userId: number | string) => `${userId}/vitrine/vitrine.json`

export async function loadVitrine(db: Db, userId: number | string): Promise<Vitrine> {
  const { data, error } = await db.storage.from(FILES_BUCKET).download(fileOf(userId))
  if (error || !data) return { items: [] }
  try {
    const parsed = JSON.parse(await data.text())
    const items: any[] = Array.isArray(parsed.items) ? parsed.items : []
    // Older entries stored the full short URL.
    for (const i of items) if (i.shortCode === undefined) i.shortCode = typeof i.shortUrl === "string" ? i.shortUrl.split("/r/")[1] || null : null
    for (const i of items) delete i.shortUrl
    return { items }
  } catch {
    return { items: [] }
  }
}

export async function saveVitrine(db: Db, userId: number | string, vitrine: Vitrine) {
  const body = new Blob([JSON.stringify(vitrine, null, 2)], { type: "application/json" })
  const { error } = await db.storage.from(FILES_BUCKET).upload(fileOf(userId), body, { upsert: true, contentType: "application/json", cacheControl: "0" })
  if (error) throw new Error(`Não foi possível salvar a vitrine: ${error.message}`)
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/**
 * Adds or updates products (matched by link). New products get the next number.
 * Returns the stored items in input order.
 */
export async function upsertVitrineItems(
  db: Db,
  userId: number | string,
  input: Array<{ title: string; category: string; emoji?: string; link: string; imagePath?: string | null; affiliate?: boolean; pending?: boolean }>,
) {
  const vitrine = await loadVitrine(db, userId)
  const now = new Date().toISOString()
  const result: VitrineItem[] = []
  for (const raw of input) {
    const link = clean(raw.link, 500)
    const title = clean(raw.title, 80)
    if (!/^https?:\/\//i.test(link) || !title) throw new Error(`Produto inválido: ${title || link || "(vazio)"}`)
    const category = clean(raw.category, 30) || "Outros"
    let item = vitrine.items.find((i) => i.link === link)
    if (!item) {
      const number = vitrine.items.reduce((max, i) => Math.max(max, i.number), 0) + 1
      const shortUrl = canTrack(link) ? await createTrackedLink(db, { userId }, { url: link }) : null
      item = { number, title, category, link, shortCode: shortUrl?.split("/r/")[1] || null, pending: raw.pending !== false, createdAt: now, updatedAt: now }
      vitrine.items.push(item)
    }
    item.title = title
    item.category = category
    item.emoji = clean(raw.emoji, 8) || item.emoji
    if (raw.imagePath) item.imagePath = raw.imagePath
    if (typeof raw.affiliate === "boolean") item.affiliate = raw.affiliate
    if (typeof raw.pending === "boolean") item.pending = raw.pending
    item.updatedAt = now
    result.push(item)
  }
  await saveVitrine(db, userId, vitrine)
  return result
}

/**
 * Shows the products whose link went out in a published post (called by the publishing queue).
 * Returns the numbers that became visible.
 */
export async function releaseVitrineItems(db: Db, userId: number | string, urls: string[]) {
  const wanted = new Set(urls.filter(Boolean))
  if (!wanted.size) return []
  const vitrine = await loadVitrine(db, userId)
  const released = vitrine.items.filter((i) => i.pending && wanted.has(i.link))
  if (!released.length) return []
  const now = new Date().toISOString()
  for (const i of released) {
    i.pending = false
    i.updatedAt = now
  }
  await saveVitrine(db, userId, vitrine)
  return released.map((i) => i.number)
}

/** Link used on the public page (relative, so it works on any domain the page is served from). */
// Rechecks canTrack: a short code stored before a link became untrackable is not used.
export const vitrineHref = (item: VitrineItem) => (item.shortCode && canTrack(item.link) ? `/r/${item.shortCode}` : item.link)

/** Visible items grouped by category, newest first inside each category. */
export function groupVitrine(items: VitrineItem[]) {
  const visible = items.filter((i) => !i.hidden && !i.pending)
  const categories = [...new Set(visible.map((i) => i.category))].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  return categories.map((category) => ({ category, items: visible.filter((i) => i.category === category).sort((a, b) => b.number - a.number) }))
}
