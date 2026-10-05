import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { FILES_BUCKET } from "@/lib/files"
import { sendAlert } from "@/lib/notify"
import { releaseVitrineItems } from "@/lib/vitrine"
import { CHILDREN_PREFIX, PUBLISH_HEARTBEAT, containerStatus, createCarouselChildren, createCarouselParent, createContainer, createPostRule, publishContainer, type PostKind } from "@/lib/publishing"

// Publishes the scheduled queue (scheduled_posts). Called every 5 minutes by Supabase pg_cron
// (migrations/008_agendador_pg_cron.sql) and, as a backup, by GitHub Actions (publicar-agenda.yml),
// always with "Authorization: Bearer $CRON_SECRET".
//
// Each item: pending → (due) container created → processing → FINISHED on Instagram → published + rule.
// Photos finish in seconds and are published in the same run; Reels/videos usually on the next run.
// Carousels: items are created first (container_id "children:…"); once every item is FINISHED the
// carousel container is created and published like the rest.
// Failures retry up to 3 times (15 min apart), then the item is marked failed and an alert is sent.

export const maxDuration = 60

const MAX_ATTEMPTS = 3
const RETRY_MINUTES = 15
const DUE_PER_RUN = 4
const PROCESSING_TIMEOUT_MIN = 60
const POLL_UNTIL_MS = 45_000

type Row = {
  id: string
  user_id: number
  kind: PostKind
  label: string
  batch: string
  media_paths: string[]
  cover_path: string | null
  caption: string
  rule: any
  container_id: string | null
  attempts: number
  processing_since: string | null
}

const now = () => new Date().toISOString()

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  const db = await getSupabaseServerClient()
  const log: string[] = []
  // Heartbeat: lets /api/agent/status and the health check tell whether the scheduler is running.
  await db.from("processed_events").upsert({ event_key: PUBLISH_HEARTBEAT, created_at: now() }, { onConflict: "event_key" })

  const { data: users } = await db.from("users").select("id, username, access_token")
  const tokenOf = new Map<number, string>((users || []).filter((u: any) => u.access_token).map((u: any) => [u.id, u.access_token]))

  const update = (id: string, fields: Record<string, unknown>) => db.from("scheduled_posts").update({ ...fields, updated_at: now() }).eq("id", id)

  // Links of a post's products. A post without a rule (e.g. the question Story, which already talks
  // about the product) borrows them from the items of the same folder in the same batch — the label
  // is "<kind> · <folder>[ · <file>]" (conteudo/kit/agendar.mjs) — so the product shows on the vitrine
  // as soon as anything about it is published.
  async function vitrineUrls(row: Row): Promise<string[]> {
    const ruleUrls = (rule: any) => (rule ? [rule.link, ...(String(rule.message || "").match(/https?:\/\/[^\s<>"']+/g) || [])] : [])
    if (row.rule) return ruleUrls(row.rule)
    const folder = row.label.split(" · ")[1]
    if (!folder || !row.batch) return []
    const { data } = await db
      .from("scheduled_posts")
      .select("label, rule")
      .eq("user_id", row.user_id)
      .eq("batch", row.batch)
      .not("rule", "is", null)
      .neq("status", "canceled")
    return (data || []).filter((r: any) => String(r.label).split(" · ")[1] === folder).flatMap((r: any) => ruleUrls(r.rule))
  }

  async function fail(row: Row, message: string, retry: boolean) {
    const attempts = row.attempts + 1
    if (retry && attempts < MAX_ATTEMPTS) {
      await update(row.id, {
        status: "pending",
        attempts,
        error: message,
        container_id: null,
        processing_since: null,
        scheduled_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString(),
      })
      log.push(`${row.label || row.id}: tentativa ${attempts} falhou, nova tentativa em ${RETRY_MINUTES} min (${message})`)
      return
    }
    await update(row.id, { status: "failed", attempts, error: message, processing_since: null })
    await sendAlert(db, `post:${row.id}`, "post agendado não foi publicado", `${row.kind} "${row.label}": ${message}`)
    log.push(`${row.label || row.id}: FALHOU (${message})`)
  }

  async function finish(row: Row, token: string, containerId: string) {
    let published: { mediaId: string; permalink: string | null }
    try {
      published = await publishContainer(token, containerId)
    } catch (e: any) {
      // Never retry something that did go live (it would be posted twice).
      const after = await containerStatus(token, containerId).catch(() => null)
      if (after?.status === "PUBLISHED") {
        await update(row.id, { status: "published", published_at: now(), processing_since: null, error: "publicado (sem confirmação do link)" })
        return
      }
      return fail(row, `publicação: ${e?.message}`, true)
    }
    let ruleId: string | null = null
    let ruleError: string | null = null
    if (row.rule) {
      try {
        ruleId = (await createPostRule(db, row.user_id, published.mediaId, row.rule, row.kind === "story" ? "story" : "comment")).id
      } catch (e: any) {
        ruleError = `publicado, mas a regra não foi criada: ${e?.message}`
        await sendAlert(db, `post-rule:${row.id}`, "regra do post agendado não foi criada", `${row.label}: ${e?.message}. Crie a regra no painel.`)
      }
    }
    await update(row.id, {
      status: "published",
      media_id: published.mediaId,
      permalink: published.permalink,
      rule_id: ruleId,
      error: ruleError,
      published_at: now(),
      processing_since: null,
    })
    // Products of this post appear on the vitrine (link da bio) only now that the post is live.
    try {
      const shown = await releaseVitrineItems(db, row.user_id, await vitrineUrls(row))
      if (shown.length) log.push(`vitrine: nº ${shown.join(", ")} liberado(s)`)
    } catch (e: any) {
      log.push(`vitrine: falha ao liberar (${e?.message})`)
    }
    // Instagram keeps its own copy; the uploaded files are no longer needed.
    const files = [...row.media_paths, ...(row.cover_path ? [row.cover_path] : [])]
    if (files.length) await db.storage.from(FILES_BUCKET).remove(files)
    log.push(`${row.label || row.id}: publicado ${published.permalink || published.mediaId}`)
  }

  /** Checks a container; publishes it when ready. Returns true when the item left "processing". */
  async function check(row: Row): Promise<boolean> {
    const token = tokenOf.get(row.user_id)
    if (!token) {
      await fail(row, "conta do Instagram desconectada", true)
      return true
    }
    try {
      if (row.container_id!.startsWith(CHILDREN_PREFIX)) {
        const children = row.container_id!.slice(CHILDREN_PREFIX.length).split(",")
        const states = await Promise.all(children.map((id) => containerStatus(token, id)))
        const bad = states.find((s) => s.status === "ERROR" || s.status === "EXPIRED")
        if (bad) {
          await fail(row, `o Instagram recusou um item do carrossel (${bad.detail || bad.status})`, true)
          return true
        }
        if (!states.every((s) => s.status === "FINISHED")) {
          const since = row.processing_since ? Date.parse(row.processing_since) : Date.now()
          if (Date.now() - since > PROCESSING_TIMEOUT_MIN * 60_000) {
            await fail(row, "o Instagram não terminou de processar os vídeos do carrossel", true)
            return true
          }
          return false
        }
        row.container_id = await createCarouselParent(token, children, row.caption)
        await update(row.id, { container_id: row.container_id })
      }
      const { status, detail } = await containerStatus(token, row.container_id!)
      if (status === "FINISHED") {
        await finish(row, token, row.container_id!)
        return true
      }
      if (status === "ERROR" || status === "EXPIRED") {
        await fail(row, `o Instagram recusou a mídia (${detail || status})`, true)
        return true
      }
      if (status === "PUBLISHED") {
        await update(row.id, { status: "published", published_at: now(), processing_since: null })
        return true
      }
      const since = row.processing_since ? Date.parse(row.processing_since) : Date.now()
      if (Date.now() - since > PROCESSING_TIMEOUT_MIN * 60_000) {
        await fail(row, "o Instagram não terminou de processar o vídeo", true)
        return true
      }
      return false
    } catch (e: any) {
      log.push(`${row.label || row.id}: erro ao consultar (${e?.message})`)
      return false
    }
  }

  // 1. Items claimed by a run that died before creating the container go back to the queue.
  await db
    .from("scheduled_posts")
    .update({ status: "pending", processing_since: null, updated_at: now() })
    .eq("status", "processing")
    .is("container_id", null)
    .lt("processing_since", new Date(Date.now() - 15 * 60_000).toISOString())

  // 2. Containers already processing on Instagram.
  const { data: processing } = await db.from("scheduled_posts").select("*").eq("status", "processing").not("container_id", "is", null)
  const waiting: Row[] = []
  for (const row of (processing || []) as Row[]) if (!(await check(row))) waiting.push(row)

  // 3. Due items: claim, upload to Instagram.
  const { data: due } = await db
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now())
    .order("scheduled_at", { ascending: true })
    .limit(DUE_PER_RUN)

  for (const candidate of (due || []) as Row[]) {
    const { data: claimed } = await db
      .from("scheduled_posts")
      .update({ status: "processing", processing_since: now(), updated_at: now() })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("*")
    const row = claimed?.[0] as Row | undefined
    if (!row) continue // another run took it

    const token = tokenOf.get(row.user_id)
    if (!token) {
      await fail(row, "conta do Instagram desconectada", true)
      continue
    }
    try {
      // Meta downloads the files itself; videos may be fetched a while later, hence the long expiry.
      const files = [...row.media_paths, ...(row.cover_path ? [row.cover_path] : [])]
      const { data: signed, error } = await db.storage.from(FILES_BUCKET).createSignedUrls(files, 24 * 3600)
      if (error || !signed?.every((s: any) => s.signedUrl)) throw new Error("arquivos não encontrados no armazenamento")
      const urls = signed.map((s: any) => s.signedUrl as string)
      const coverUrl = row.cover_path ? urls.pop()! : null
      const containerId =
        row.kind === "carousel"
          ? CHILDREN_PREFIX + (await createCarouselChildren(token, urls)).join(",")
          : await createContainer(token, row.kind, urls, row.caption, coverUrl)
      await update(row.id, { container_id: containerId })
      const fresh = { ...row, container_id: containerId }
      if (!(await check(fresh))) waiting.push(fresh)
    } catch (e: any) {
      await fail(row, e?.message || "erro desconhecido", true)
    }
  }

  // 4. Videos usually finish within a minute: keep checking while this run has time left.
  while (waiting.length && Date.now() - started < POLL_UNTIL_MS) {
    await new Promise((r) => setTimeout(r, 5000))
    for (let i = waiting.length - 1; i >= 0; i--) if (await check(waiting[i])) waiting.splice(i, 1)
  }
  for (const row of waiting) log.push(`${row.label || row.id}: o Instagram ainda está processando`)

  if (log.length) console.log("[cron/publish]", log.join(" | "))
  return NextResponse.json({ ok: true, log })
}
