"use client"

import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { Automation } from "@/lib/types"

type Source = Automation["trigger_source"]

export function QuickAutomationForm({ userId, initialSource, onSuccess }: {
  userId: string
  initialSource: Source
  onSuccess: (source: Source) => void
}) {
  const [source, setSource] = useState<Source>(initialSource)
  const [keyword, setKeyword] = useState("")
  const [answer, setAnswer] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  const field = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !keyword.trim() || !answer.trim()) return
    submitting.current = true
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: `Resposta para ${keyword.trim()}`,
          trigger_source: source,
          trigger_type: source === "story" ? "reply" : "keyword",
          trigger_value: keyword.trim(),
          content: { message: answer.trim(), ...(source === "comment" ? { reply_mode: "dm_only" } : {}) },
          specific_media_id: null,
        }),
      })
      if (!response.ok) throw new Error("Não foi possível salvar. Tente de novo.")
      setKeyword("")
      setAnswer("")
      onSuccess(source)
    } catch {
      setError("Não foi possível salvar. Verifique sua conexão e tente de novo.")
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <form onSubmit={save} className="overflow-hidden rounded-xl border border-border bg-card">
    <fieldset disabled={saving} className="min-w-0">
      <label className="flex items-center gap-3 border-b border-border px-4 py-3"><span className="shrink-0 text-xs text-muted-foreground">Responder a</span>
        <select value={source} onChange={event => setSource(event.target.value as Source)} className="rounded-md bg-card py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="dm">Mensagens no DM</option><option value="comment">Comentários em posts</option><option value="story">Respostas ao Story</option>
        </select>
      </label>
      <div className="grid sm:grid-cols-[1fr_2fr]">
      <label className="block border-b border-border p-4 sm:border-b-0 sm:border-r"><span className="text-xs font-medium text-muted-foreground">Quando disserem</span>
        <input required value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="ex.: preço" className="mt-2 w-full rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      <label className="block p-4"><span className="text-xs font-medium text-muted-foreground">Enviar esta resposta</span>
        <textarea required maxLength={1000} rows={3} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Nossos produtos começam em R$ 49,90. Aqui está o link…" className="mt-2 w-full resize-y rounded-sm bg-card py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{source === "comment" ? "Qualquer post ou reel · Resposta enviada por DM" : source === "story" ? "Busca palavras-chave nas respostas ao Story" : "Busca palavras-chave nas DMs recebidas"}</p>
      <button disabled={saving || !keyword.trim() || !answer.trim()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving && <Loader2 className="size-4 animate-spin" />}{saving ? "Salvando…" : "Salvar resposta"}
      </button>
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </fieldset>
  </form>
}
