"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Download, Loader2, Search } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { TagInput } from "@/components/ui/tag-input"
import { EVENT_LABELS } from "@/lib/contacts-query"

interface Contact {
  ig_id: string
  username: string | null
  follows: boolean | null
  opted_out: boolean
  tags: string[]
  last_keyword: string | null
  last_event: string | null
  first_seen_at: string
  last_seen_at: string
  interactions: number
}

interface ContactsResponse {
  contacts: Contact[]
  filteredTotal: number
  pageSize: number
  page: number
  stats: { total: number; follows: number; notFollows: number; optedOut: number }
  tags: string[]
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })

const select = "rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export default function ContactsPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [tag, setTag] = useState("")
  const [follows, setFollows] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const filterParams = useCallback(() => {
    const params = new URLSearchParams({ userId: userId || "" })
    if (q.trim()) params.set("q", q.trim())
    if (tag) params.set("tag", tag)
    if (follows) params.set("follows", follows)
    if (status) params.set("status", status)
    return params
  }, [userId, q, tag, follows, status])

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const params = filterParams()
      params.set("page", String(page))
      const res = await fetch(`/api/contacts?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json)
      setError("")
    } catch {
      setError("Não foi possível carregar os contatos. Tente de novo.")
    } finally {
      setLoading(false)
    }
  }, [userId, filterParams, page])

  // Debounce typing in the search box.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => { setPage(0) }, [q, tag, follows, status])

  async function saveTags(contact: Contact, tags: string[]) {
    setData(current => current && { ...current, contacts: current.contacts.map(c => c.ig_id === contact.ig_id ? { ...c, tags } : c) })
    const res = await fetch("/api/contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, igId: contact.ig_id, tags }),
    })
    if (!res.ok) setError("Não foi possível salvar as tags. Tente de novo.")
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return null

  const stats = data?.stats
  const totalPages = data ? Math.max(1, Math.ceil(data.filteredTotal / data.pageSize)) : 1

  return <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contatos</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Todo mundo que comentou, mandou DM ou interagiu com as suas automações.</p>
      </div>
      <a href={`/api/contacts/export?${filterParams()}`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
        <Download className="size-4" /> Exportar CSV
      </a>
    </header>

    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ["Contatos", stats?.total],
        ["Seguem a conta", stats?.follows],
        ["Não seguem", stats?.notFollows],
        ["Saíram da lista", stats?.optedOut],
      ].map(([label, value]) => (
        <div key={label as string} className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
        </div>
      ))}
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-muted-foreground">
        <Search className="size-3.5" />
        <input aria-label="Buscar por usuário" placeholder="Buscar @usuário..." value={q} onChange={e => setQ(e.target.value)} className="w-full bg-transparent text-xs text-foreground outline-none" />
      </label>
      <select aria-label="Filtrar por tag" value={tag} onChange={e => setTag(e.target.value)} className={select}>
        <option value="">Todas as tags</option>
        {data?.tags.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="Filtrar por seguidor" value={follows} onChange={e => setFollows(e.target.value)} className={select}>
        <option value="">Segue ou não</option>
        <option value="yes">Segue</option>
        <option value="no">Não segue</option>
        <option value="unknown">Não verificado</option>
      </select>
      <select aria-label="Filtrar por status" value={status} onChange={e => setStatus(e.target.value)} className={select}>
        <option value="">Todos</option>
        <option value="active">Ativos</option>
        <option value="out">Saíram da lista</option>
      </select>
    </div>

    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}

    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-border bg-card text-xs text-muted-foreground">
          <tr>
            <th className="w-8 px-3 py-2.5" />
            <th className="px-3 py-2.5 font-medium">Usuário</th>
            <th className="px-3 py-2.5 font-medium">Última interação</th>
            <th className="px-3 py-2.5 font-medium">Segue?</th>
            <th className="px-3 py-2.5 font-medium">Tags</th>
            <th className="px-3 py-2.5 text-right font-medium">Interações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading && !data ? (
            <tr><td colSpan={6} className="px-3 py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></td></tr>
          ) : data?.contacts.length ? data.contacts.map(contact => (
            <Fragment key={contact.ig_id}>
              <tr className="cursor-pointer hover:bg-accent/40" onClick={() => setOpen(open === contact.ig_id ? null : contact.ig_id)}>
                <td className="px-3 py-3 text-muted-foreground">{open === contact.ig_id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                <td className="px-3 py-3">
                  {contact.username
                    ? <a href={`https://instagram.com/${contact.username}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="font-medium hover:underline">@{contact.username}</a>
                    : <span className="text-muted-foreground">sem usuário</span>}
                  {contact.opted_out && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">saiu da lista</span>}
                </td>
                <td className="px-3 py-3">
                  <p>{EVENT_LABELS[contact.last_event || ""] || "—"}{contact.last_keyword && <span className="text-muted-foreground"> · “{contact.last_keyword}”</span>}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(contact.last_seen_at)}</p>
                </td>
                <td className="px-3 py-3">{contact.follows === true ? "Sim" : contact.follows === false ? "Não" : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.length ? contact.tags.map(t => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{t}</span>) : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{contact.interactions}</td>
              </tr>
              {open === contact.ig_id && <tr><td colSpan={6} className="bg-card/50 px-6 py-4"><ContactDetails userId={userId} contact={contact} onTags={tags => void saveTags(contact, tags)} /></td></tr>}
            </Fragment>
          )) : (
            <tr><td colSpan={6} className="px-3 py-8 text-sm text-muted-foreground">
              {data?.stats.total ? "Nenhum contato com esses filtros." : "Ainda não há contatos. Eles aparecem aqui quando alguém comenta ou manda DM para a conta."}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>

    {data && data.filteredTotal > data.pageSize && (
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.filteredTotal} contatos · página {page + 1} de {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Anterior</button>
          <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Próxima</button>
        </div>
      </div>
    )}
  </div>
}

function ContactDetails({ userId, contact, onTags }: { userId: string; contact: Contact; onTags: (tags: string[]) => void }) {
  const [events, setEvents] = useState<Array<{ event: string; keyword: string | null; created_at: string; rule: string | null }> | null>(null)

  useEffect(() => {
    fetch(`/api/contacts/events?userId=${userId}&igId=${contact.ig_id}`)
      .then(res => res.json())
      .then(json => setEvents(json.events || []))
      .catch(() => setEvents([]))
  }, [userId, contact.ig_id])

  return <div className="grid gap-6 sm:grid-cols-2">
    <div className="space-y-2">
      <p className="text-xs font-medium">Tags</p>
      <TagInput value={contact.tags} onChange={onTags} placeholder="digite uma tag e aperte Enter" />
      <p className="text-[11px] text-muted-foreground">
        Primeiro contato em {formatDate(contact.first_seen_at)}. Use tags para separar interessados, clientes, campanhas…
      </p>
    </div>
    <div className="space-y-2">
      <p className="text-xs font-medium">Histórico</p>
      {events === null ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : events.length ? (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatDate(e.created_at)}</span>
              <span>{EVENT_LABELS[e.event] || e.event}{e.keyword && ` “${e.keyword}”`}{e.rule && <span className="text-muted-foreground"> · {e.rule}</span>}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Sem interações registradas ainda.</p>}
    </div>
  </div>
}
