"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Eye, EyeOff, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { cn } from "@/lib/utils"

type Item = {
  number: number
  title: string
  category: string
  emoji?: string
  link: string
  imagePath?: string | null
  hidden?: boolean
  pending?: boolean
  affiliate?: boolean
  clicks: number | null
}

export default function VitrinePage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState<number | null>(null)
  const pageUrl = typeof window === "undefined" ? "/links" : `${window.location.origin}/links`

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/vitrine?userId=${userId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setItems(json.items)
    } catch {
      setError("Não foi possível carregar a vitrine.")
      setItems([])
    }
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function toggle(item: Item) {
    setSaving(item.number)
    const res = await fetch(`/api/vitrine?userId=${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: item.number, hidden: !item.hidden }) })
    if (res.ok) setItems(current => (current || []).map(i => (i.number === item.number ? { ...i, hidden: !item.hidden } : i)))
    else setError("Não foi possível salvar.")
    setSaving(null)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl)
      toast.success("Link da vitrine copiado")
    } catch {
      toast.error("Não foi possível copiar")
    }
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return null

  return <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">Vitrine (link da bio)</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Página pública com todos os produtos dos posts, numerados e separados por categoria. Cada produto aparece na página sozinho quando
        o primeiro post dele é publicado. Coloque o link abaixo na bio do Instagram.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-muted px-3 py-2 text-sm">{pageUrl}</code>
        <button onClick={() => void copyLink()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><Copy className="size-4" /> Copiar</button>
        <a href="/links" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><ExternalLink className="size-4" /> Abrir</a>
      </div>
    </header>

    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

    {items === null ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : items.length === 0 ? (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhum produto ainda.</div>
    ) : (
      <ul className="divide-y divide-border rounded-xl border border-border">
        {items.map(item => <li key={item.number} className={cn("flex items-center gap-3 px-4 py-3", (item.hidden || item.pending) && "opacity-60")}>
          <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">nº {item.number}</span>
          <div className="size-11 shrink-0 overflow-hidden rounded-md bg-muted">
            {item.imagePath && <img src={`/api/vitrine/img/${item.number}`} alt="" loading="lazy" className="size-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.emoji ? `${item.emoji} ` : ""}{item.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {item.pending && <span className="font-medium text-amber-700 dark:text-amber-300">Aguardando o primeiro post · </span>}
              {item.category}{item.affiliate ? " · afiliado" : " · produto próprio"}
              {" · "}{item.clicks === null ? "cliques no painel da Amazon" : `${item.clicks} clique${item.clicks === 1 ? "" : "s"}`}
            </p>
          </div>
          <a href={item.link} target="_blank" rel="noreferrer" aria-label="Abrir o produto" title="Abrir o produto" className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /></a>
          <button onClick={() => void toggle(item)} disabled={saving === item.number} aria-label={item.hidden ? "Mostrar na vitrine" : "Esconder da vitrine"} title={item.hidden ? "Mostrar na vitrine" : "Esconder da vitrine"} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            {saving === item.number ? <Loader2 className="size-4 animate-spin" /> : item.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </li>)}
      </ul>
    )}
  </div>
}
