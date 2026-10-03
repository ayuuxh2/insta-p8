import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { ALLOWED_EXTENSIONS, extensionOf, FILES_BUCKET } from "@/lib/files"

// GET /api/files?userId= — uploaded files with how many times each link was opened.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data, error } = await db
    .from("files")
    .select("id, name, size_bytes, mime_type, created_at, tracked_links(clicks)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: "Não foi possível carregar os arquivos" }, { status: 500 })

  return NextResponse.json({
    files: (data || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      size_bytes: f.size_bytes,
      mime_type: f.mime_type,
      created_at: f.created_at,
      sent: (f.tracked_links || []).length,
      opens: (f.tracked_links || []).reduce((sum: number, l: any) => sum + (l.clicks || 0), 0),
    })),
  })
}

// POST /api/files { userId, path, name, size } — registers a file after the browser uploaded it.
export async function POST(request: NextRequest) {
  const { userId, path, name, size } = await request.json().catch(() => ({}))
  if (!userId || typeof path !== "string" || typeof name !== "string" || !path.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  }

  const db = await getSupabaseServerClient()
  const folder = path.slice(0, path.lastIndexOf("/"))
  const fileName = path.slice(path.lastIndexOf("/") + 1)
  const { data: listed } = await db.storage.from(FILES_BUCKET).list(folder, { search: fileName, limit: 1 })
  const stored = listed?.find((o: any) => o.name === fileName)
  if (!stored) return NextResponse.json({ error: "O envio não foi concluído. Tente de novo." }, { status: 400 })

  const { data, error } = await db
    .from("files")
    .insert({
      user_id: userId,
      name: name.slice(0, 200),
      storage_path: path,
      size_bytes: stored.metadata?.size ?? size ?? 0,
      mime_type: ALLOWED_EXTENSIONS[extensionOf(name)] || null,
    })
    .select("id, name, size_bytes, mime_type, created_at")
    .single()
  if (error) return NextResponse.json({ error: "Não foi possível salvar o arquivo" }, { status: 500 })
  return NextResponse.json({ file: { ...data, sent: 0, opens: 0 } })
}

// DELETE /api/files?userId=&id= — removes the file; links already sent stop working.
export async function DELETE(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const id = request.nextUrl.searchParams.get("id")
  if (!userId || !id) return NextResponse.json({ error: "Dados ausentes" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const { data: file } = await db.from("files").select("storage_path").eq("id", id).eq("user_id", userId).maybeSingle()
  if (!file) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 })

  await db.storage.from(FILES_BUCKET).remove([file.storage_path])
  const { error } = await db.from("files").delete().eq("id", id).eq("user_id", userId)
  if (error) return NextResponse.json({ error: "Não foi possível excluir" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
