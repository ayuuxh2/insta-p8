"use client"

import { useEffect, useState } from "react"
import { Save, Loader2, Check } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"

const fields = [
    ["business_name", "Nome do negócio", "Como os clientes chamam o seu negócio?"],
    ["business_description", "O que você faz", "Descreva seu negócio e o que você vende."],
    ["services", "Produtos e preços", "Liste produtos, serviços, preços e detalhes importantes."],
    ["hours_location", "Horário e localização", "Informe horário de funcionamento, endereço, entrega ou região atendida."],
    ["policies", "Políticas", "Informe as regras de troca, devolução, cancelamento e pagamento."],
    ["faq", "Perguntas frequentes", "Adicione as dúvidas mais comuns dos clientes e as respostas certas."],
] as const

export default function SettingsPage() {
    const { userId, isLoading: sessionLoading } = useInstagramSession()
    const [knowledge, setKnowledge] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        if (!userId) return
        fetch(`/api/business-profile?userId=${userId}`)
            .then((res) => res.json())
            .then((data) => setKnowledge(data.knowledge ?? {}))
            .finally(() => setLoading(false))
    }, [userId])

    const update = (key: string, value: string) => setKnowledge((current) => ({ ...current, [key]: value }))

    const save = async () => {
        if (!userId || saving) return
        setSaving(true)
        const res = await fetch("/api/business-profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, knowledge }),
        })
        if (res.ok) {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        }
        setSaving(false)
    }

    if (sessionLoading || loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>

    return (
        <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10">
            <div className="border-b border-border pb-7">
                <p className="text-sm text-muted-foreground">Informações do negócio</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">Preferências</h1>
                <p className="mt-2 text-sm text-muted-foreground">Passe informações certinhas do seu negócio para o assistente responder melhor.</p>
            </div>
            <div className="mt-7 space-y-5 rounded-xl border border-border bg-card p-6">
                {fields.map(([key, label, placeholder]) => (
                    <label key={key} className="block space-y-2">
                        <span className="text-sm font-medium text-foreground">{label}</span>
                        <textarea value={knowledge[key] ?? ""} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} rows={key === "business_name" ? 2 : 4} className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                    </label>
                ))}
            </div>
            <button onClick={save} disabled={saving} className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? "Salvo" : "Salvar informações do negócio"}
            </button>
            {userId && <Diagnostics userId={userId} />}
        </div>
    )
}

interface LogEvent {
    id: string
    event_type: string
    processed_at: string
    data: { de?: string; texto?: string; resultado?: string } | null
}

// Last received comments/messages and what the bot did with each (kept for 14 days).
function Diagnostics({ userId }: { userId: string }) {
    const [events, setEvents] = useState<LogEvent[] | null>(null)
    const [error, setError] = useState("")

    const load = () => {
        setEvents(null)
        fetch(`/api/webhook-log?userId=${userId}`)
            .then((res) => res.json())
            .then((json) => { if (json.error) throw new Error(json.error); setEvents(json.events) })
            .catch(() => { setError("Não foi possível carregar o registro."); setEvents([]) })
    }
    useEffect(load, [userId])

    const failed = (e: LogEvent) => /falha|erro/i.test(e.data?.resultado || "")

    return (
        <section className="mt-12 border-t border-border pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Diagnóstico</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Últimos comentários e mensagens que chegaram e o que a automação fez com cada um (guardado por 14 dias).
                    </p>
                </div>
                <button onClick={load} className="rounded-md border border-border px-3 py-1.5 text-xs">Atualizar</button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            {events === null ? <Loader2 className="mt-4 size-5 animate-spin text-muted-foreground" /> : events.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nada recebido ainda. Comente num post com uma palavra-chave para testar.</p>
            ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="border-b border-border bg-card text-muted-foreground">
                            <tr><th className="px-3 py-2 font-medium">Quando</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">De</th><th className="px-3 py-2 font-medium">Texto</th><th className="px-3 py-2 font-medium">Resultado</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {events.map((e) => (
                                <tr key={e.id} className={failed(e) ? "bg-destructive/5" : undefined}>
                                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{new Date(e.processed_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                                    <td className="px-3 py-2">{e.event_type}</td>
                                    <td className="px-3 py-2">{e.data?.de || "—"}</td>
                                    <td className="max-w-48 truncate px-3 py-2" title={e.data?.texto}>{e.data?.texto || "—"}</td>
                                    <td className={`px-3 py-2 ${failed(e) ? "text-destructive" : ""}`}>{e.data?.resultado || "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
