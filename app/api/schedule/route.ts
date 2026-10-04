import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { FILES_BUCKET } from "@/lib/files"

// Dashboard view of the publishing queue (Agenda de posts).
// GET /api/schedule?userId= — last 3 days and everything ahead, with temporary links to preview the media
//   (files are deleted once Instagram has its own copy, so published items have no preview, only the permalink).
// DELETE /api/schedule?userId=&id= — cancels an item that was not published yet.

const PREVIEW_SECONDS = 3600

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })
  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("scheduled_posts")
    .select("id, kind, label, batch, scheduled_at, status, permalink, error, published_at, caption, rule, media_paths, cover_path")
    .eq("user_id", userId)
    .gte("scheduled_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(400)
  if (error) return NextResponse.json({ error: "Não foi possível carregar a agenda" }, { status: 500 })

  const rows = data || []
  const paths = [...new Set(rows.filter((r: any) => r.status === "pending" || r.status === "failed").flatMap((r: any) => [...(r.media_paths || []), ...(r.cover_path ? [r.cover_path] : [])]))]
  const urlOf = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await db.storage.from(FILES_BUCKET).createSignedUrls(paths, PREVIEW_SECONDS)
    for (const s of signed || []) if (s.path && s.signedUrl) urlOf.set(s.path, s.signedUrl)
  }

  const items = rows.map(({ media_paths, cover_path, rule, ...r }: any) => ({
    ...r,
    media: (media_paths || []).map((p: string) => ({ url: urlOf.get(p) || null, video: /\.mp4$/i.test(p) })).filter((m: any) => m.url),
    cover: cover_path ? urlOf.get(cover_path) || null : null,
    rule: rule
      ? { keywords: rule.keywords || [], anyComment: rule.anyComment === true, message: rule.message || "", link: rule.link || "", checkFollow: rule.checkFollow !== false }
      : null,
  }))
  return NextResponse.json({ items })
}

export async function DELETE(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const id = request.nextUrl.searchParams.get("id")
  if (!userId || !id) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("scheduled_posts")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending")
    .select("media_paths, cover_path")
  if (error) return NextResponse.json({ error: "Não foi possível cancelar" }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: "Esse post já foi enviado ou não existe" }, { status: 409 })
  const files = data.flatMap((r: any) => [...(r.media_paths || []), ...(r.cover_path ? [r.cover_path] : [])])
  if (files.length) await db.storage.from(FILES_BUCKET).remove(files)
  return NextResponse.json({ ok: true })
}
