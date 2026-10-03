"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useInstagramSession } from "@/hooks/use-instagram-session"

interface Metrics {
  days: number
  totals: {
    comments: number; dms: number; stories: number; optinSent: number; optinTaps: number; delivered: number; clicks: number
    gateSent: number; gateConverted: number; newContacts: number; optOuts: number; optedOutTotal: number
    peopleReached: number; peopleClicked: number
  }
  limit: { privateRepliesLastHour: number; max: number }
  byRule: Array<{ id: string; name: string; source: string | null; triggers: number; taps: number; delivered: number; clicks: number; gates: number }>
  daily: Array<{ day: string; triggers: number; delivered: number; clicks: number }>
}

const SERIES = {
  triggers: "Disparos (comentários, DMs, stories)",
  delivered: "Conteúdos entregues",
  clicks: "Cliques em links",
} as const
type SeriesKey = keyof typeof SERIES

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—")
const shortDay = (day: string) => { const [, m, d] = day.split("-"); return `${d}/${m}` }
const SOURCE_LABEL: Record<string, string> = { comment: "Comentário", dm: "DM", story: "Story" }

export default function AnalyticsPage() {
  const { userId, isLoading: sessionLoading } = useInstagramSession()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Metrics | null>(null)
  const [error, setError] = useState("")
  const [series, setSeries] = useState<SeriesKey>("triggers")
  const [asTable, setAsTable] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/metrics?userId=${userId}&days=${days}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json)
      setError("")
    } catch {
      setError("Não foi possível carregar as métricas. Tente de novo.")
    }
  }, [userId, days])
  useEffect(() => { void load() }, [load])

  if (sessionLoading) return <div className="p-8"><Loader2 className="size-5 animate-spin" /></div>
  if (!userId) return null
  const t = data?.totals

  // Comment funnel: each step relative to the first.
  const funnel = t ? [
    { label: "Comentários com palavra-chave", value: t.comments },
    { label: 'Cartão "Quero receber" enviado', value: t.optinSent },
    { label: 'Tocaram em "Quero receber"', value: t.optinTaps },
    { label: "Receberam o conteúdo", value: t.delivered },
    { label: "Clicaram em um link", value: t.clicks },
  ] : []
  const funnelMax = Math.max(1, ...funnel.map(s => s.value))

  return <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Métricas</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Do comentário ao clique: como as suas respostas automáticas estão funcionando.</p>
      </div>
      <div role="group" aria-label="Período" className="flex rounded-lg border border-border p-0.5 text-xs">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={`rounded-md px-3 py-1.5 ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {d} dias
          </button>
        ))}
      </div>
    </header>

    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {!data ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pessoas que receberam conteúdo" value={t!.peopleReached} />
        <Stat label="Pessoas que clicaram" value={t!.peopleClicked} note={pct(t!.peopleClicked, t!.peopleReached) + " de quem recebeu"} />
        <Stat label="Novos contatos" value={t!.newContacts} />
        <Stat label="Seguiram após o pedido" value={t!.gateConverted} note={t!.gateSent ? `${pct(t!.gateConverted, t!.gateSent)} de ${t!.gateSent} pedidos` : "nenhum pedido no período"} />
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Funil dos comentários</h2>
        <p className="mt-1 text-xs text-muted-foreground">Percentual em relação aos comentários com palavra-chave.</p>
        <ol className="mt-4 space-y-3">
          {funnel.map((step, i) => (
            <li key={step.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[14rem_minmax(0,1fr)_5rem]">
              <span className="text-xs">{step.label}</span>
              <div className="order-last col-span-2 h-2.5 rounded-full bg-muted sm:order-none sm:col-span-1">
                <div className="h-full rounded-full" style={{ width: `${(step.value / funnelMax) * 100}%`, background: "var(--chart-brand)" }} />
              </div>
              <span className="text-right text-xs tabular-nums">
                <strong className="font-semibold">{step.value}</strong>
                {i > 0 && <span className="text-muted-foreground"> · {pct(step.value, funnel[0].value)}</span>}
              </span>
            </li>
          ))}
        </ol>
        {t!.dms + t!.stories > 0 && <p className="mt-4 text-[11px] text-muted-foreground">Também no período: {t!.dms} DMs e {t!.stories} interações em Stories que dispararam respostas.</p>}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{SERIES[series]} por dia</h2>
          <div className="flex items-center gap-2">
            <select aria-label="Série do gráfico" value={series} onChange={e => setSeries(e.target.value as SeriesKey)} className="rounded-md border border-border bg-card px-2 py-1.5 text-xs">
              {Object.entries(SERIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button onClick={() => setAsTable(v => !v)} className="rounded-md border border-border px-2 py-1.5 text-xs">{asTable ? "Ver gráfico" : "Ver tabela"}</button>
          </div>
        </div>
        {asTable ? (
          <div className="mt-4 max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr><th className="py-1 text-left font-medium">Dia</th>{Object.values(SERIES).map(l => <th key={l} className="py-1 text-right font-medium">{l}</th>)}</tr></thead>
              <tbody>{[...data.daily].reverse().map(d => <tr key={d.day} className="border-t border-border"><td className="py-1">{shortDay(d.day)}</td><td className="py-1 text-right tabular-nums">{d.triggers}</td><td className="py-1 text-right tabular-nums">{d.delivered}</td><td className="py-1 text-right tabular-nums">{d.clicks}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  content={({ active, payload }) => active && payload?.length ? (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                      <p className="text-muted-foreground">{shortDay(String(payload[0].payload.day))}</p>
                      <p className="mt-0.5"><strong className="tabular-nums">{payload[0].value as number}</strong> {SERIES[series].toLowerCase()}</p>
                    </div>
                  ) : null}
                />
                <Bar dataKey={series} fill="var(--chart-brand)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-5 py-4 text-sm font-semibold">Por regra</h2>
        {data.byRule.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma regra foi disparada no período.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="px-5 py-2 text-left font-medium">Regra</th><th className="px-3 py-2 text-right font-medium">Disparos</th><th className="px-3 py-2 text-right font-medium">Toques</th><th className="px-3 py-2 text-right font-medium">Entregas</th><th className="px-3 py-2 text-right font-medium">Cliques</th><th className="px-5 py-2 text-right font-medium">Cliques / entregas</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.byRule.map(r => (
                  <tr key={r.id}>
                    <td className="px-5 py-2.5"><p className="font-medium">{r.name}</p>{r.source && <p className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source] || r.source}{r.gates > 0 && ` · ${r.gates} pedidos para seguir`}</p>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.triggers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.taps}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.delivered}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.clicks}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{pct(r.clicks, r.delivered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Respostas privadas na última hora: <strong className="tabular-nums text-foreground">{data.limit.privateRepliesLastHour}</strong> de {data.limit.max} (limite de segurança; o Instagram permite 750).
        {" "}Saíram da lista no período: {t!.optOuts} · no total: {t!.optedOutTotal}.
      </p>
    </>}
  </div>
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
  </div>
}
