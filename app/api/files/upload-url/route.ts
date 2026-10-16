import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { ALLOWED_EXTENSIONS, extensionOf, FILES_BUCKET, MAX_FILE_BYTES, safeFileName } from "@/lib/files"

// POST /api/files/upload-url { userId, name, size } — signed URL so the browser uploads
// straight to Supabase Storage (Vercel functions cap request bodies at 4.5 MB).
export async function POST(request: NextRequest) {
  const { userId, name, size } = await request.json().catch(() => ({}))
  if (!userId || typeof name !== "string" || typeof size !== "number") {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  }
  if (!ALLOWED_EXTENSIONS[extensionOf(name)]) {
    return NextResponse.json({ error: "Tipo de arquivo não permitido. Use PDF, imagem, vídeo, áudio, ZIP ou documentos do Office." }, { status: 400 })
  }
  if (size <= 0 || size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "O arquivo precisa ter no máximo 50 MB." }, { status: 400 })
  }

  const path = `${userId}/${randomUUID().slice(0, 8)}-${safeFileName(name)}`
  const db = await getSupabaseServerClient()
  const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error("[files] createSignedUploadUrl failed:", error?.message)
    return NextResponse.json({ error: "Não foi possível preparar o envio. O espaço de arquivos foi criado no Supabase?" }, { status: 500 })
  }
  return NextResponse.json({ path, signedUrl: data.signedUrl, contentType: ALLOWED_EXTENSIONS[extensionOf(name)] })
}
