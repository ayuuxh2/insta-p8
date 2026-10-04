import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { FILES_BUCKET } from "@/lib/files"

// POST /api/agent/upload-url { name } → signed URL to upload one carousel slide (JPEG) to private storage.
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { name } = await request.json().catch(() => ({}))
  if (typeof name !== "string" || !/\.jpe?g$/i.test(name)) {
    return NextResponse.json({ error: "Envie imagens .jpg (o Instagram só publica JPEG)" }, { status: 400 })
  }

  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })

  const path = `${user.id}/posts/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}/${name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
  const { data, error } = await db.storage.from(FILES_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `Não foi possível preparar o envio: ${error?.message}` }, { status: 500 })
  return NextResponse.json({ path, signedUrl: data.signedUrl })
}
