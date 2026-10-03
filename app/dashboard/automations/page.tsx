"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, Pencil, Search, Trash2 } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { QuickAutomationForm } from "@/components/dashboard/QuickAutomationForm"
import { AssistantSettings } from "@/components/dashboard/AssistantSettings"
import { CreateRuleForm } from "@/components/dashboard/CreateRuleForm"
import type { Automation } from "@/lib/types"

export default function AutomationsPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [rules, setRules] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [edit, setEdit] = useState<Automation | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Full editor for a new rule (post selection, follow gate, card, variations...).
  const [creating, setCreating] = useState<Automation["trigger_source"] | null>(null)
  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const response = await fetch(`/api/automations?userId=${userId}`)
      const data = await response.json()
      if (!response.ok || !Array.isArray(data)) throw new Error()
      setRules(data)
      setError("")
    } catch { setError("Não foi possível carregar as automações. Tente de novo.") }
    finally { setLoading(false) }
  }, [userId])
  useEffect(() => { void refresh() }, [refresh])

  async function update(rule: Automation, remove = false) {
    if (busy) return
    setBusy(rule.id)
    try {
      const response = await fetch(remove ? `/api/automations?id=${rule.id}` : "/api/automations", {
        method: remove ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(remove ? {} : { body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }) }),
      })
      if (!response.ok) throw new Error()
      setRules(current => remove ? current.filter(item => item.id !== rule.id) : current.map(item => item.id === rule.id ? { ...item, is_active: !item.is_active } : item))
      setDeleting(null)
    } catch { setError("Não foi possível salvar essa alteração. Tente de novo.") }
    finally { setBusy(null) }
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return <p className="p-8 text-sm text-muted-foreground">Conecte sua conta do Instagram para criar automações.</p>

  const filtered = rules.filter(rule => `${rule.name} ${rule.trigger_value} ${rule.response_content?.message || ""}`.toLowerCase().includes(query.toLowerCase()))
  const button = "rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-8 flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Respostas automáticas</h1><p className="mt-1.5 text-sm text-muted-foreground">Chegou a palavra-chave, sai a sua resposta.</p></div>
      <span className="pt-1 text-xs text-muted-foreground">{(n => `${n} ${n === 1 ? "ativa" : "ativas"}`)(rules.filter(rule => rule.is_active).length)}</span>
    </header>
    {edit || creating ? <section>
      <button className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setEdit(null); setCreating(null) }}><ArrowLeft className="size-4" />Voltar para respostas automáticas</button>
      <CreateRuleForm key={edit?.id || `new-${creating}`} userId={userId} triggerSource={edit?.trigger_source || creating!} editRule={edit} onSuccess={() => { setEdit(null); setCreating(null); void refresh() }} />
    </section> : <>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="mr-auto text-muted-foreground">Editor completo (post específico, só para seguidores, cartão, variações):</span>
        <button onClick={() => setCreating("comment")} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Nova regra de comentário</button>
        <button onClick={() => setCreating("dm")} className="rounded-md border border-border px-3 py-1.5 text-xs">Nova regra de DM</button>
        <button onClick={() => setCreating("story")} className="rounded-md border border-border px-3 py-1.5 text-xs">Nova regra de Story</button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Ou crie rápido:</p>
      <QuickAutomationForm userId={userId} initialSource="dm" onSuccess={() => { setSaved(true); void refresh() }} />
      {saved && <p role="status" className="mt-3 text-xs text-muted-foreground">Salva e ativa. Você pode adicionar outra resposta acima.</p>}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Suas respostas <span className="ml-1 text-muted-foreground">{rules.length}</span></h2>
          {rules.length > 0 && <label className="flex items-center gap-2 text-muted-foreground"><Search className="size-3.5" /><input aria-label="Buscar respostas" placeholder="Buscar palavra-chave..." value={query} onChange={event => setQuery(event.target.value)} className="w-40 bg-background py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>}
        </div>
        {error && <div role="alert" className="mb-3 flex items-center justify-between text-sm"><span>{error}</span><button onClick={() => void refresh()} className="underline">Tentar de novo</button></div>}
        {loading ? <Loader2 className="my-8 size-5 animate-spin text-muted-foreground" /> :
          <div className="divide-y divide-border border-y border-border">
            {filtered.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-3 py-4 sm:flex-nowrap">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.trigger_value}</p><p className="mt-1 truncate text-sm text-muted-foreground">{rule.response_content?.message || rule.response_content?.card?.title || rule.name}</p><p className="mt-1.5 text-xs text-muted-foreground">{rule.trigger_source === "dm" ? "DM" : rule.trigger_source === "comment" ? "Comentário" : "Story"}{rule.specific_media_id ? " · Post selecionado" : ""}</p></div>
              {deleting === rule.id ? <div className="flex items-center gap-2 text-xs"><span>Excluir esta resposta?</span><button disabled={!!busy} onClick={() => void update(rule, true)} className="rounded-md bg-primary px-3 py-2 text-primary-foreground">Excluir</button><button onClick={() => setDeleting(null)} className={button}>Cancelar</button></div> :
                <div className="flex items-center gap-1">
                  <button disabled={!!busy} onClick={() => void update(rule)} aria-label={`${rule.is_active ? "Pausar" : "Ativar"} ${rule.name}`} aria-pressed={rule.is_active} className="mr-2 flex min-w-16 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs">{busy === rule.id ? <Loader2 className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${rule.is_active ? "bg-foreground" : "bg-muted-foreground"}`} />}{rule.is_active ? "Ativa" : "Pausada"}</button>
                  <button onClick={() => setEdit(rule)} aria-label={`Editar ${rule.name}`} className={button}><Pencil className="size-3.5" /></button>
                  <button onClick={() => setDeleting(rule.id)} aria-label={`Excluir ${rule.name}`} className={button}><Trash2 className="size-3.5" /></button>
                </div>}
            </div>)}
            {!filtered.length && <p className="py-8 text-sm text-muted-foreground">{query ? "Nenhuma resposta encontrada." : "Nenhuma resposta ainda. Adicione sua primeira palavra-chave e resposta acima."}</p>}
          </div>}
      </section>
      <AssistantSettings userId={userId} />
    </>}
  </div>
}
