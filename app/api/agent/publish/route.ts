import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"
import { describeGraphError } from "@/lib/instagram-api"

export const maxDuration = 60

const GRAPH = "https://graph.instagram.com/v24.0"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function graph(token: string, path: string, init: { method?: string; body?: Record<string, unknown> } = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(describeGraphError(json.error || `HTTP ${res.status}`))
  return json
}

async function waitFinished(token: string, containerId: string) {
  for (let i = 0; i < 15; i++) {
    const { status_code } = await graph(token, `${containerId}?fields=status_code`)
    if (status_code === "FINISHED") return
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`O Instagram recusou a mídia (${status_code})`)
    await sleep(2000)
  }
  throw new Error("O Instagram demorou demais para processar as imagens")
}

// POST /api/agent/publish { paths: string[], caption } — publishes a carousel (2–10 JPEGs) or a single photo.
// Returns { mediaId, permalink }.
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { paths, caption } = await request.json().catch(() => ({}))
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 10 || typeof caption !== "string") {
    return NextResponse.json({ error: "Envie de 1 a 10 imagens e a legenda" }, { status: 400 })
  }
  if (caption.length > 2200) return NextResponse.json({ error: "Legenda acima de 2.200 caracteres" }, { status: 400 })

  const { db, user } = await agentUser()
  if (!user?.access_token) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  if (paths.some((p: string) => typeof p !== "string" || !p.startsWith(`${user.id}/posts/`))) {
    return NextResponse.json({ error: "Caminho de imagem inválido" }, { status: 400 })
  }

  try {
    // Meta downloads the images itself, so they need temporary public URLs.
    const { data: signed, error } = await db.storage.from(FILES_BUCKET).createSignedUrls(paths, 3600)
    if (error || !signed?.every((s: any) => s.signedUrl)) throw new Error("Não foi possível gerar os links das imagens")
    const urls = signed.map((s: any) => s.signedUrl as string)
    const token = user.access_token

    let creationId: string
    if (urls.length === 1) {
      creationId = (await graph(token, "me/media", { method: "POST", body: { image_url: urls[0], caption } })).id
    } else {
      const children: string[] = []
      for (const url of urls) {
        children.push((await graph(token, "me/media", { method: "POST", body: { image_url: url, is_carousel_item: true } })).id)
      }
      for (const child of children) await waitFinished(token, child)
      creationId = (await graph(token, "me/media", { method: "POST", body: { media_type: "CAROUSEL", children: children.join(","), caption } })).id
    }
    await waitFinished(token, creationId)
    const { id: mediaId } = await graph(token, "me/media_publish", { method: "POST", body: { creation_id: creationId } })
    const { permalink } = await graph(token, `${mediaId}?fields=permalink`)

    // Slides are no longer needed once Instagram has its own copy.
    await db.storage.from(FILES_BUCKET).remove(paths)
    return NextResponse.json({ ok: true, mediaId, permalink })
  } catch (e: any) {
    console.error("[agent/publish]", e?.message)
    return NextResponse.json({ error: `Falha ao publicar: ${e?.message}` }, { status: 502 })
  }
}
