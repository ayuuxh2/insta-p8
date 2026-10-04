import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { FILES_BUCKET } from "@/lib/files"

// Dashboard view of the publishing queue (Agenda de posts).
// GET /api/schedule?userId= — last 3 days and everything ahead.
// DELETE /api/schedule?userId=&id= — cancels an item that was not published yet.

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })
  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("scheduled_posts")
    .select("id, kind, label, batch, scheduled_at, status, permalink, error, published_at, caption")
    .eq("user_id", userId)
    .gte("scheduled_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(400)
  if (error) return NextResponse.json({ error: "Não foi possível carregar a agenda" }, { status: 500 })
  return NextResponse.json({ items: data })
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
