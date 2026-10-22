"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Bot, FolderPlus, Grid2X2, Inbox, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react"
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
  const [showCreate, setShowCreate] = useState(false)
  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const response = await fetch(`/api/automations?userId=${userId}`)
      const data = await response.json()
      if (!response.ok || !Array.isArray(data)) throw new Error()
      setRules(data)
      setError("")
    } catch { setError("Could not load automations. Please retry.") }
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
    } catch { setError("Could not save that change. Please try again.") }
    finally { setBusy(null) }
  }

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return <p className="p-8 text-sm text-muted-foreground">Connect your Instagram account to create automations.</p>

  const filtered = rules.filter(rule => `${rule.name} ${rule.trigger_value} ${rule.response_content?.message || ""}`.toLowerCase().includes(query.toLowerCase()))
  const button = "rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return <div className="min-h-full bg-[#f7f7f8] text-[#17181a] dark:bg-[#101112] dark:text-white">
    <div className="flex min-h-12 items-center justify-center gap-3 bg-[#242526] px-4 py-2 text-sm text-white">
      <span className="flex size-6 items-center justify-center rounded-full bg-emerald-400 text-xs font-bold text-[#102019]">✦</span>
      <span className="hidden sm:inline">Turn conversations into customers with automated replies.</span>
      <button onClick={() => setShowCreate(true)} className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-400">Create automation</button>
    </div>
    <div className="border-b border-black/10 bg-white px-6 py-5 dark:border-white/10 dark:bg-[#151617] sm:px-10">
      <div className="mx-auto max-w-6xl"><h1 className="text-2xl font-semibold tracking-tight">Automation</h1></div>
    </div>
    <div className="mx-auto flex max-w-6xl gap-8 px-5 py-8 sm:px-10">
      <aside className="hidden w-44 shrink-0 space-y-1 md:block">
        {[{ label: "My Automations", icon: <Bot className="size-4" /> }, { label: "Basic", icon: <Grid2X2 className="size-4" /> }, { label: "Sequences", icon: <Inbox className="size-4" /> }].map((item, index) => <button key={item.label} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${index === 0 ? "bg-black/10 font-medium dark:bg-white/10" : "text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"}`}>{item.icon}{item.label}</button>)}
      </aside>
      <section className="min-w-0 flex-1">
        {edit ? <section>
      <button className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setEdit(null)}><ArrowLeft className="size-4" />Back to auto replies</button>
      <CreateRuleForm key={edit.id} userId={userId} triggerSource={edit.trigger_source} editRule={edit} onSuccess={() => { setEdit(null); void refresh() }} />
    </section> : <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold">My Automations</h2><p className="mt-1 text-sm text-black/50 dark:text-white/50">Create, manage and monitor your Instagram workflows.</p></div><button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#1473e6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0d63cc]"><Plus className="size-4" /> New Automation</button></div>
      {showCreate && <div className="mb-8 rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#18191b] sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">New automation</h3><p className="mt-1 text-xs text-black/50 dark:text-white/50">Choose a trigger and write the reply.</p></div><button onClick={() => setShowCreate(false)} className="rounded-md p-2 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/5"><X className="size-4" /></button></div><QuickAutomationForm userId={userId} initialSource="dm" onSuccess={() => { setSaved(true); setShowCreate(false); void refresh() }} /></div>}
      {saved && <p role="status" className="mb-4 text-xs text-muted-foreground">Saved and active.</p>}
      <div className="mb-6 flex flex-wrap items-center gap-3"><label className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-[#18191b]"><Search className="size-4 text-black/40 dark:text-white/40" /><input aria-label="Search automations" placeholder="Search all automations" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-black/40 dark:placeholder:text-white/40" /></label><button className="inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-black/20 px-3 text-sm text-black/60 hover:bg-black/5 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/5"><FolderPlus className="size-4" /> New folder</button></div>
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">Automations <span className="ml-1 text-muted-foreground">{rules.length}</span></h2><span className="text-xs text-black/40 dark:text-white/40">{rules.filter(rule => rule.is_active).length} active</span></div>
        {error && <div role="alert" className="mb-3 flex items-center justify-between text-sm"><span>{error}</span><button onClick={() => void refresh()} className="underline">Retry</button></div>}
        {loading ? <Loader2 className="my-8 size-5 animate-spin text-muted-foreground" /> :
          <div className="divide-y divide-border border-y border-border">
            {filtered.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-3 py-4 sm:flex-nowrap">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.trigger_value}</p><p className="mt-1 truncate text-sm text-muted-foreground">{rule.response_content?.message || rule.response_content?.card?.title || rule.name}</p><p className="mt-1.5 text-xs text-muted-foreground">{rule.trigger_source === "dm" ? "Direct message" : rule.trigger_source === "comment" ? "Post comment" : "Story"}{rule.specific_media_id ? " · Selected post" : ""}</p></div>
              {deleting === rule.id ? <div className="flex items-center gap-2 text-xs"><span>Delete this reply?</span><button disabled={!!busy} onClick={() => void update(rule, true)} className="rounded-md bg-primary px-3 py-2 text-primary-foreground">Delete</button><button onClick={() => setDeleting(null)} className={button}>Cancel</button></div> :
                <div className="flex items-center gap-1">
                  <button disabled={!!busy} onClick={() => void update(rule)} aria-label={`${rule.is_active ? "Pause" : "Activate"} ${rule.name}`} aria-pressed={rule.is_active} className="mr-2 flex min-w-16 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs">{busy === rule.id ? <Loader2 className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${rule.is_active ? "bg-foreground" : "bg-muted-foreground"}`} />}{rule.is_active ? "On" : "Paused"}</button>
                  <button onClick={() => setEdit(rule)} aria-label={`Edit ${rule.name}`} className={button}><Pencil className="size-3.5" /></button>
                  <button onClick={() => setDeleting(rule.id)} aria-label={`Delete ${rule.name}`} className={button}><Trash2 className="size-3.5" /></button>
                </div>}
            </div>)}
            {!filtered.length && <p className="py-8 text-sm text-muted-foreground">{query ? "No matching replies." : "No replies yet. Add your first keyword and answer above."}</p>}
          </div>}
      </section>
      <AssistantSettings userId={userId} />
    </>}
      </section>
    </div>
  </div>
}
