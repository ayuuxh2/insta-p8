"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Loader2, X } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { cn } from "@/lib/utils"

type Item = {
  id: string
  kind: "reel" | "carousel" | "image" | "story"
  label: string
  scheduled_at: string
  status: "pending" | "processing" | "published" | "failed" | "canceled"
  permalink: string | null
  error: string | null
  caption: string
}

const KIND = { reel: "Reel", carousel: "Carrossel", image: "Foto", story: "Story" }
const STATUS: Record<Item["status"], { text: string; className: string }> = {
  pending: { text: "Na fila", className: "bg-muted text-muted-foreground" },
  processing: { text: "Enviando", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  published: { text: "Publicado", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  failed: { text: "Falhou", className: "bg-destructive/15 text-destructive" },
  canceled: { text: "Cancelado", className: "bg-muted text-muted-foreground line-through" },
}
const TZ = "America/Sao_Paulo"
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" })
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

export default function AgendaPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const [canceling, setCanceling] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/schedule?userId=${userId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setItems(json.items)
    } catch {
      setError("Não foi possível carregar a agenda.")
      setItems([])
    }
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function cancel(id: string) {
    setCanceling(id)
    const res = await fetch(`/api/schedule?userId=${userId}&id=${id}`, { method: "DELETE" })
    const json = await res.json().catch(() => ({}))
    if (res.ok) setItems(current => (current || []).map(i => (i.id === id ? { ...i, status: "canceled" } : i)))
    else setError(json.error || "Não foi possível cancelar.")
    setCanceling(null)
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return null

  const upcoming = (items || []).filter(i => i.status === "pending" || i.status === "processing")
  const days = new Map<string, Item[]>()
  for (const item of items || []) {
    const key = dayKey(item.scheduled_at)
    days.set(key, [...(days.get(key) || []), item])
  }

  return <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">Agenda de posts</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Reels, carrosséis e Stories publicados automaticamente no horário marcado (horário de Brasília). A fila é conferida a
        cada 5 minutos. {items && `${upcoming.length} na fila.`}
      </p>
    </header>

    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

    {items === null ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : items.length === 0 ? (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Nada agendado. Os posts da semana entram aqui quando forem aprovados e agendados.
      </div>
    ) : (
      <div className="space-y-8">
        {[...days.entries()].map(([day, list]) => <section key={day}>
          <h2 className="mb-2 text-sm font-semibold capitalize text-muted-foreground">{day}</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.map(item => <li key={item.id} className="flex items-start gap-4 px-4 py-3">
              <span className="w-12 shrink-0 pt-0.5 font-mono text-sm tabular-nums">{time(item.scheduled_at)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.label || KIND[item.kind]}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {KIND[item.kind]}{item.caption ? ` · ${item.caption.split("\n")[0].slice(0, 80)}` : ""}
                </p>
                {item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS[item.status].className)}>{STATUS[item.status].text}</span>
              {item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer" aria-label="Abrir no Instagram" title="Abrir no Instagram" className="shrink-0 text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /></a>}
              {item.status === "pending" && <button onClick={() => void cancel(item.id)} disabled={canceling === item.id} aria-label="Cancelar este post" title="Cancelar este post" className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50">
                {canceling === item.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              </button>}
            </li>)}
          </ul>
        </section>)}
      </div>
    )}
  </div>
}
