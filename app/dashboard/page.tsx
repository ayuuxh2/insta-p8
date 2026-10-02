"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Bot, CheckCircle2, Loader2, MessageSquare, Plus, Users, Workflow } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"

interface DashboardStats {
  metrics: { totalAutomations: number; activeTriggers: number; audienceReached: number; messagesSent: number }
  recentActivity: Array<{ id: string; content: string; created_at: string; recipient?: { recipient_username: string } }>
}

export default function DashboardPage() {
  const { username, userId, isLoading: sessionLoading } = useInstagramSession()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    fetch(`/api/dashboard/stats?userId=${userId}`)
      .then(response => response.json())
      .then(data => { if (data && !data.error) setStats(data) })
      .catch(error => console.error("Failed to load dashboard stats", error))
      .finally(() => setLoading(false))
  }, [userId])

  if (sessionLoading || loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

  const metrics = stats?.metrics
  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10">
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 sm:flex-row sm:items-end">
        <div><p className="text-sm text-muted-foreground">Que bom te ver, {username || "você"}</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">Seu painel</h1></div>
        <Link href="/dashboard/automations" className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="size-4" />Criar automação</Link>
      </header>

      <section className="grid border-b border-border sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo da conta">
        <Metric label="Automações" value={metrics?.totalAutomations ?? 0} icon={Workflow} />
        <Metric label="Gatilhos ativos" value={metrics?.activeTriggers ?? 0} icon={CheckCircle2} />
        <Metric label="Mensagens enviadas" value={metrics?.messagesSent ?? 0} icon={MessageSquare} />
        <Metric label="Pessoas alcançadas" value={metrics?.audienceReached ?? 0} icon={Users} />
      </section>

      <div className="grid gap-6 py-7 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Conversas recentes</h2><p className="mt-1 text-xs text-muted-foreground">Últimas respostas enviadas pelas suas automações</p></div><Link href="/dashboard/inbox" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Ver todas<ArrowRight className="size-3.5" /></Link></div>
          <div className="divide-y divide-border">
            {stats?.recentActivity?.length ? stats.recentActivity.slice(0, 6).map(message => <div key={message.id} className="flex items-center gap-3 px-5 py-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary"><MessageSquare className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">@{message.recipient?.recipient_username || "instagram_user"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{message.content}</p></div><time className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div>) : <EmptyState icon={MessageSquare} title="Nenhuma conversa ainda" description="As novas respostas automáticas vão aparecer aqui." />}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-secondary"><Bot className="size-4" /></span><div><h2 className="text-sm font-semibold">Status das automações</h2><p className="mt-0.5 text-xs text-muted-foreground">Sua conta está conectada</p></div></div><dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">Instagram</dt><dd className="flex items-center gap-1.5 font-medium"><span className="size-1.5 rounded-full bg-foreground" />Conectado</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Automações ativas</dt><dd className="font-medium">{metrics?.activeTriggers ?? 0}</dd></div></dl></section>
          <section className="rounded-xl bg-primary p-5 text-primary-foreground"><h2 className="text-sm font-semibold">Crie sua próxima automação</h2><p className="mt-2 text-xs leading-5 text-primary-foreground/75">Transforme um comentário, uma DM ou uma resposta ao Story em uma resposta automática.</p><Link href="/dashboard/automations" className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold">Criar automação<ArrowRight className="size-3.5" /></Link></section>
        </aside>
      </div>
    </div>
  )
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="border-border py-6 sm:border-r sm:px-6 first:pl-0 last:border-r-0"><div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">{label}</p><Icon className="size-4 text-muted-foreground" /></div><p className="mt-3 text-3xl font-semibold tracking-tight">{value.toLocaleString("pt-BR")}</p></div>
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><span className="flex size-10 items-center justify-center rounded-lg bg-secondary"><Icon className="size-4 text-muted-foreground" /></span><h3 className="mt-4 text-sm font-medium">{title}</h3><p className="mt-1.5 text-xs text-muted-foreground">{description}</p></div>
}
