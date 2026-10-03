"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Loader2, Trash2, Upload } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { uploadFile, type UploadedFile } from "@/lib/upload-file"
import { formatBytes } from "@/lib/files"

export default function FilesPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [files, setFiles] = useState<UploadedFile[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/files?userId=${userId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setFiles(json.files)
    } catch {
      setError("Não foi possível carregar os arquivos.")
      setFiles([])
    }
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function onPick(list: FileList | null) {
    if (!userId || !list?.length) return
    setUploading(true)
    setError("")
    try {
      for (const file of Array.from(list)) {
        const saved = await uploadFile(userId, file)
        setFiles(current => [saved, ...(current || [])])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/files?userId=${userId}&id=${id}`, { method: "DELETE" })
    if (res.ok) setFiles(current => (current || []).filter(f => f.id !== id))
    else setError("Não foi possível excluir o arquivo.")
    setDeleting(null)
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return null

  return <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Arquivos</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Materiais para enviar pelas respostas automáticas (catálogos, e-books, cupons…). Ficam privados: cada pessoa recebe
          um link próprio, que abre o arquivo por 10 minutos.
        </p>
      </div>
      <button onClick={() => input.current?.click()} disabled={uploading} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {uploading ? "Enviando…" : "Enviar arquivo"}
      </button>
      <input ref={input} type="file" multiple hidden onChange={e => void onPick(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.mp3,.m4a,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.epub" />
    </header>

    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <p className="mb-3 text-xs text-muted-foreground">PDF, imagens, vídeo, áudio, ZIP e documentos do Office · até 50 MB cada.</p>

    {files === null ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : files.length === 0 ? (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nenhum arquivo ainda. Envie um e depois anexe numa resposta automática (editor completo → etapa 2).
      </div>
    ) : (
      <ul className="divide-y divide-border rounded-xl border border-border">
        {files.map(file => (
          <li key={file.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size_bytes)} · enviado para {file.sent} {file.sent === 1 ? "pessoa" : "pessoas"} · aberto {file.opens} {file.opens === 1 ? "vez" : "vezes"}
              </p>
            </div>
            {deleting === file.id ? (
              <div className="flex items-center gap-2 text-xs">
                <span>Excluir? Os links já enviados param de funcionar.</span>
                <button onClick={() => void remove(file.id)} className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground">Excluir</button>
                <button onClick={() => setDeleting(null)} className="rounded-md border border-border px-3 py-1.5">Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setDeleting(file.id)} aria-label={`Excluir ${file.name}`} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
}
