// Browser-side upload: signed URL from our API → PUT straight to Supabase Storage → register.

export interface UploadedFile {
  id: string
  name: string
  size_bytes: number
  mime_type: string | null
  created_at: string
  sent: number
  opens: number
}

export async function uploadFile(userId: string, file: File): Promise<UploadedFile> {
  const prep = await fetch("/api/files/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, name: file.name, size: file.size }),
  })
  const prepJson = await prep.json().catch(() => ({}))
  if (!prep.ok) throw new Error(prepJson.error || "Não foi possível preparar o envio.")

  // Same request format as supabase-js uploadToSignedUrl.
  const body = new FormData()
  body.append("cacheControl", "3600")
  body.append("", new Blob([file], { type: prepJson.contentType || file.type }), file.name)
  const put = await fetch(prepJson.signedUrl, { method: "PUT", body, headers: { "x-upsert": "false" } })
  if (!put.ok) throw new Error("O envio do arquivo falhou. Verifique sua internet e tente de novo.")

  const done = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, path: prepJson.path, name: file.name, size: file.size }),
  })
  const doneJson = await done.json().catch(() => ({}))
  if (!done.ok) throw new Error(doneJson.error || "Não foi possível salvar o arquivo.")
  return doneJson.file
}
