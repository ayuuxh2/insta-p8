"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Film, Images, Loader2, MessageCircle, X } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Media = { url: string; video: boolean }
type Item = {
  id: string
  kind: "reel" | "carousel" | "image" | "story"
  label: string
  scheduled_at: string
  status: "pending" | "processing" | "published" | "failed" | "canceled"
  permalink: string | null
  error: string | null
  caption: string
  media: Media[]
  cover: string | null
  rule: { keywords: string[]; anyComment: boolean; message: string; link: string; checkFollow: boolean } | null
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

/** Image shown in the list: the Reel cover, the first slide or the Story itself. */
function thumbOf(item: Item): Media | null {
  if (item.cover) return { url: item.cover, video: false }
  return item.media[0] || null
}

function Thumb({ item }: { item: Item }) {
  const thumb = thumbOf(item)
  const tall = item.kind === "reel" || item.kind === "story"
  return <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-muted", tall ? "h-16 w-9" : "h-14 w-11")}>
    {thumb ? (thumb.video
      ? <video src={thumb.url} muted preload="metadata" className="size-full object-cover" />
      : <img src={thumb.url} alt="" loading="lazy" className="size-full object-cover" />)
      : <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">{item.status === "published" ? "✓" : "—"}</span>}
    {item.kind === "carousel" && item.media.length > 1 && <Images className="absolute right-0.5 top-0.5 size-3 text-white drop-shadow" />}
    {(item.kind === "reel" || thumb?.video) && <Film className="absolute right-0.5 top-0.5 size-3 text-white drop-shadow" />}
  </div>
}

function Preview({ item }: { item: Item }) {
  if (!item.media.length) {
    return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {item.status === "published" ? "Já publicado — os arquivos ficam só no Instagram." : "Prévia indisponível."}
    </p>
  }
  return <div className="flex snap-x gap-3 overflow-x-auto pb-2">
    {item.media.map((m, i) => (
      <div key={i} className={cn("shrink-0 snap-start overflow-hidden rounded-lg bg-black", item.kind === "carousel" ? "w-60" : "w-56")}>
        {m.video
          ? <video src={m.url} poster={item.cover || undefined} controls playsInline preload="metadata" className="aspect-[9/16] w-full object-contain" />
          : <img src={m.url} alt={`Mídia ${i + 1}`} className={cn("w-full object-contain", item.kind === "carousel" ? "aspect-[4/5]" : "aspect-[9/16]")} />}
      </div>
    ))}
  </div>
}

export default function AgendaPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")
  const [canceling, setCanceling] = useState<string | null>(null)
  const [open, setOpen] = useState<Item | null>(null)

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
    if (res.ok) {
      setItems(current => (current || []).map(i => (i.id === id ? { ...i, status: "canceled", media: [], cover: null } : i)))
      setOpen(null)
    } else setError(json.error || "Não foi possível cancelar.")
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
        cada 5 minutos. Toque num post para ver a imagem, a legenda e a mensagem da DM. {items && `${upcoming.length} na fila.`}
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
            {list.map(item => <li key={item.id}>
              <button onClick={() => setOpen(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <span className="w-12 shrink-0 font-mono text-sm tabular-nums">{time(item.scheduled_at)}</span>
                <Thumb item={item} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label || KIND[item.kind]}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {KIND[item.kind]}
                    {item.rule && ` · palavra ${item.rule.anyComment ? "qualquer" : item.rule.keywords[0]?.toUpperCase()}`}
                    {item.caption ? ` · ${item.caption.split("\n")[0]}` : ""}
                  </p>
                  {item.error && <p className="mt-1 truncate text-xs text-destructive">{item.error}</p>}
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS[item.status].className)}>{STATUS[item.status].text}</span>
              </button>
            </li>)}
          </ul>
        </section>)}
      </div>
    )}

    <Dialog open={!!open} onOpenChange={o => !o && setOpen(null)}>
      {open && <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{open.label || KIND[open.kind]}</DialogTitle>
          <DialogDescription className="capitalize">
            {KIND[open.kind]} · {dayKey(open.scheduled_at)} às {time(open.scheduled_at)} · {STATUS[open.status].text}
          </DialogDescription>
        </DialogHeader>

        <Preview item={open} />

        {open.caption
          ? <section>
            <h3 className="mb-1.5 text-sm font-semibold">Legenda</h3>
            <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{open.caption}</p>
          </section>
          : open.kind === "story" && <p className="text-sm text-muted-foreground">Stories não têm legenda.</p>}

        {open.rule
          ? <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><MessageCircle className="size-4" /> Resposta automática</h3>
            <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
              <p>
                {open.kind === "story" ? "Quem responder o Story com " : "Quem comentar "}
                <b>{open.rule.anyComment ? "qualquer coisa" : open.rule.keywords.map(k => k.toUpperCase()).join(", ")}</b>
                {open.rule.checkFollow ? " recebe na DM (só se seguir a conta):" : " recebe na DM:"}
              </p>
              <p className="whitespace-pre-wrap rounded-md bg-background p-2.5">{open.rule.message}</p>
              {open.rule.link && <p className="break-all text-xs text-muted-foreground">Link: <a href={open.rule.link} target="_blank" rel="noreferrer" className="underline">{open.rule.link}</a></p>}
            </div>
          </section>
          : <p className="text-sm text-muted-foreground">Sem resposta automática (post só para engajamento).</p>}

        {open.error && <p className="text-sm text-destructive">{open.error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {open.permalink && <a href={open.permalink} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
            <ExternalLink className="size-4" /> Abrir no Instagram
          </a>}
          {open.status === "pending" && <button onClick={() => void cancel(open.id)} disabled={canceling === open.id} className="inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/40 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
            {canceling === open.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Cancelar este post
          </button>}
        </div>
      </DialogContent>}
    </Dialog>
  </div>
}
