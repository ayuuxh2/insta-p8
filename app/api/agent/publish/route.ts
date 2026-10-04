import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"
import { createContainer, publishContainer, waitFinished } from "@/lib/publishing"

export const maxDuration = 60

// POST /api/agent/publish { paths: string[], caption } — publishes a carousel (2–10 JPEGs) or a single photo.
// Returns { mediaId, permalink }. Reels and Stories go through the schedule (/api/agent/schedule).
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { paths, caption } = await request.json().catch(() => ({}))
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 10 || typeof caption !== "string") {
    return NextResponse.json({ error: "Envie de 1 a 10 imagens e a legenda" }, { status: 400 })
  }
  if (caption.length > 2200) return NextResponse.json({ error: "Legenda acima de 2.200 caracteres" }, { status: 400 })

  const { db, user } = await agentUser()
  if (!user?.access_token) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  if (paths.some((p: string) => typeof p !== "string" || !p.startsWith(`${user.id}/posts/`) || !/\.jpe?g$/i.test(p))) {
    return NextResponse.json({ error: "Caminho de imagem inválido" }, { status: 400 })
  }

  try {
    // Meta downloads the images itself, so they need temporary public URLs.
    const { data: signed, error } = await db.storage.from(FILES_BUCKET).createSignedUrls(paths, 3600)
    if (error || !signed?.every((s: any) => s.signedUrl)) throw new Error("Não foi possível gerar os links das imagens")
    const urls = signed.map((s: any) => s.signedUrl as string)
    const token = user.access_token

    const creationId = await createContainer(token, urls.length === 1 ? "image" : "carousel", urls, caption)
    await waitFinished(token, creationId)
    const { mediaId, permalink } = await publishContainer(token, creationId)

    // Slides are no longer needed once Instagram has its own copy.
    await db.storage.from(FILES_BUCKET).remove(paths)
    return NextResponse.json({ ok: true, mediaId, permalink })
  } catch (e: any) {
    console.error("[agent/publish]", e?.message)
    return NextResponse.json({ error: `Falha ao publicar: ${e?.message}` }, { status: 502 })
  }
}
