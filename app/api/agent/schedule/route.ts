import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"
import { POST_KINDS, isVideo, ruleProblem, type PostKind } from "@/lib/publishing"

// Publishing queue (published by /api/cron/publish).
//
// POST /api/agent/schedule
//   { kind: "reel" | "carousel" | "image" | "story", scheduledAt: ISO date, paths: string[], coverPath?,
//     caption?, label?, batch?, rule?: { …same fields as /api/agent/rules }, trial? }
//   reel: 1 MP4 (+ optional JPEG cover) · story: 1 JPEG or MP4 · image: 1 JPEG · carousel: 2–10 JPEG/MP4
//   For a story, the rule answers replies to the Story; otherwise it answers comments.
//   trial: true (reel only) → Reel de teste, shown to non-followers first (migrations/009).
// GET /api/agent/schedule?from=ISO — upcoming and recent items.
// DELETE /api/agent/schedule?id=… or ?batch=… — cancels items that were not published yet.

function kindProblem(kind: PostKind, paths: string[], cover?: string) {
  const videos = paths.filter(isVideo).length
  if (kind === "reel" && (paths.length !== 1 || videos !== 1)) return "Reel: envie 1 vídeo .mp4"
  if (kind === "story" && paths.length !== 1) return "Story: envie 1 imagem ou vídeo"
  if (kind === "image" && (paths.length !== 1 || videos)) return "Foto: envie 1 imagem .jpg"
  if (kind === "carousel" && (paths.length < 2 || paths.length > 10)) return "Carrossel: envie de 2 a 10 arquivos"
  if (cover && (kind !== "reel" || isVideo(cover))) return "Capa só vale para Reel e deve ser .jpg"
  return null
}

export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const kind = body.kind as PostKind
  const paths: string[] = Array.isArray(body.paths) ? body.paths.filter((p: unknown) => typeof p === "string") : []
  const cover = typeof body.coverPath === "string" ? body.coverPath : undefined
  const caption = typeof body.caption === "string" ? body.caption : ""
  const when = new Date(body.scheduledAt)

  if (!POST_KINDS.includes(kind)) return NextResponse.json({ error: "kind inválido" }, { status: 400 })
  if (Number.isNaN(when.getTime())) return NextResponse.json({ error: "scheduledAt inválido" }, { status: 400 })
  if (when.getTime() > Date.now() + 60 * 86_400_000) return NextResponse.json({ error: "Agende no máximo 60 dias à frente" }, { status: 400 })
  const problem = kindProblem(kind, paths, cover) || (caption.length > 2200 ? "Legenda acima de 2.200 caracteres" : null) || (body.rule ? ruleProblem(body.rule) : null)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const trial = body.trial === true
  if (trial && kind !== "reel") return NextResponse.json({ error: "Só Reel pode ser de teste" }, { status: 400 })

  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  if ([...paths, ...(cover ? [cover] : [])].some((p) => !p.startsWith(`${user.id}/posts/`))) {
    return NextResponse.json({ error: "Caminho de arquivo inválido (use /api/agent/upload-url)" }, { status: 400 })
  }

  const { data, error } = await db
    .from("scheduled_posts")
    .insert({
      user_id: user.id,
      kind,
      label: String(body.label || "").slice(0, 120),
      batch: String(body.batch || "").slice(0, 60),
      scheduled_at: when.toISOString(),
      media_paths: paths,
      cover_path: cover || null,
      caption,
      rule: body.rule || null,
      // Sent only when used, so scheduling keeps working before migrations/009 is applied.
      ...(trial ? { trial: true } : {}),
    })
    .select("id, kind, label, scheduled_at, status")
    .single()
  if (error) return NextResponse.json({ error: `Não foi possível agendar: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, item: data })
}

export async function GET(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  const from = request.nextUrl.searchParams.get("from") || new Date(Date.now() - 2 * 86_400_000).toISOString()
  const { data, error } = await db
    .from("scheduled_posts")
    .select("id, kind, label, batch, scheduled_at, status, permalink, error, attempts, published_at")
    .eq("user_id", user.id)
    .gte("scheduled_at", from)
    .order("scheduled_at", { ascending: true })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, items: data })
}

export async function DELETE(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const id = request.nextUrl.searchParams.get("id")
  const batch = request.nextUrl.searchParams.get("batch")
  if (!id && !batch) return NextResponse.json({ error: "Informe id ou batch" }, { status: 400 })
  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })

  let query = db.from("scheduled_posts").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "pending")
  query = id ? query.eq("id", id) : query.eq("batch", batch)
  const { data, error } = await query.select("id, media_paths, cover_path")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const files = (data || []).flatMap((r: any) => [...(r.media_paths || []), ...(r.cover_path ? [r.cover_path] : [])])
  if (files.length) await db.storage.from(FILES_BUCKET).remove(files)
  return NextResponse.json({ ok: true, canceled: data?.length || 0 })
}
