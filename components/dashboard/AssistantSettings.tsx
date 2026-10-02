"use client"
import { useEffect, useState } from "react"
import { Brain, Loader2 } from "lucide-react"
export function AssistantSettings({ userId }: { userId: string }) {
    const [aiEnabled, setAiEnabled] = useState(false)
    const [aiLoading, setAiLoading] = useState(true)
    const [aiToggling, setAiToggling] = useState(false)
    const [showAiContext, setShowAiContext] = useState(false)
    const [aiContext, setAiContext] = useState("")
    const [aiContextSaving, setAiContextSaving] = useState(false)
    const [aiContextSaved, setAiContextSaved] = useState(false)
    const [groqApiKey, setGroqApiKey] = useState("")
    const [hasApiKey, setHasApiKey] = useState(false)
    const [showApiKey, setShowApiKey] = useState(false)
    const [aiBaseUrl, setAiBaseUrl] = useState("")
    const [aiModel, setAiModel] = useState("")

    useEffect(() => {
        if (!userId) return
        fetch(`/api/groq/auto-reply?userId=${userId}`)
            .then(res => res.json())
            .then(data => {
                setAiEnabled(data.enabled ?? false)
                setAiContext(data.ai_context ?? "")
                setHasApiKey(data.has_api_key ?? false)
                setAiBaseUrl(data.ai_base_url ?? "")
                setAiModel(data.ai_model ?? "")
            })
            .catch(() => {})
            .finally(() => setAiLoading(false))
    }, [userId])

    const handleSaveAiContext = async () => {
        if (aiContextSaving) return
        setAiContextSaving(true)
        try {
            await fetch("/api/groq/auto-reply", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    enabled: aiEnabled,
                    ai_context: aiContext,
                    ai_base_url: aiBaseUrl,
                    ai_model: aiModel,
                    ...(groqApiKey !== "" ? { groq_api_key: groqApiKey } : {}),
                }),
            })
            if (groqApiKey) { setHasApiKey(true); setGroqApiKey(""); setShowApiKey(false) }
            setAiContextSaved(true)
            setTimeout(() => setAiContextSaved(false), 2000)
        } catch {}
        setAiContextSaving(false)
    }

    const handleToggleAI = async () => {
        if (aiToggling) return
        setAiToggling(true)
        const newState = !aiEnabled
        try {
            const res = await fetch("/api/groq/auto-reply", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, enabled: newState }),
            })
            if (res.ok) setAiEnabled(newState)
        } catch {}
        setAiToggling(false)
    }


return <details className="mt-6 border-t border-border pt-4"><summary className="cursor-pointer text-xs text-muted-foreground">Configurações da Resposta com IA</summary><div className="mt-4 flex items-center gap-3"><button type="button" disabled={aiLoading || aiToggling} onClick={handleToggleAI} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">{aiLoading ? "Carregando…" : aiToggling ? "Salvando…" : aiEnabled ? "IA ativada · Desligar" : "IA desligada · Ligar"}</button><button type="button" onClick={() => setShowAiContext(!showAiContext)} className="text-xs underline">Configurar assistente</button></div>{showAiContext && (
                    <div className="rounded-xl border border-border bg-card p-5 animate-in fade-in slide-in-from-top-2 duration-200 space-y-4">
                        <div className="flex items-center gap-2">
                            <Brain className="w-4 h-4" />
                            <span className="text-sm font-semibold">Configurações da Resposta com IA</span>
                        </div>

                        {/* API Key */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-neutral-400 font-medium">Chave de API</label>
                                {hasApiKey && !showApiKey && (
                                    <span className="text-[10px] text-emerald-500 font-mono">● chave salva</span>
                                )}
                            </div>
                            {showApiKey || !hasApiKey ? (
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={groqApiKey}
                                        onChange={e => setGroqApiKey(e.target.value)}
                                        placeholder={hasApiKey ? "Digite uma nova chave para substituir…" : "sk_… or gsk_…"}
                                        className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                                    />
                                    {hasApiKey && (
                                        <button onClick={() => setShowApiKey(false)} className="px-3 py-2.5 rounded-xl border border-white/10 text-neutral-500 text-xs hover:text-white transition-colors">Cancelar</button>
                                    )}
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowApiKey(true)}
                                    className="w-full text-left px-4 py-2.5 rounded-xl border border-white/10 text-neutral-500 text-sm hover:border-white/20 hover:text-white transition-colors"
                                >
                                    •••••••••••••••••••• <span className="text-xs ml-2 text-neutral-600">clique para substituir</span>
                                </button>
                            )}
                        </div>

                        {/* API Base URL */}
                        <div className="space-y-1.5">
                            <label className="text-xs text-neutral-400 font-medium">URL base da API <span className="text-neutral-600 font-normal">(opcional)</span></label>
                            <input
                                type="text"
                                value={aiBaseUrl}
                                onChange={e => setAiBaseUrl(e.target.value)}
                                placeholder="https://api.groq.com/v1  (padrão) ou seu próprio endpoint"
                                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                            />
                            <p className="text-[11px] text-neutral-600">Funciona com qualquer endpoint compatível com OpenAI — Groq, OpenAI, Together ou seu próprio proxy.</p>
                        </div>

                        {/* Model */}
                        <div className="space-y-1.5">
                            <label className="text-xs text-neutral-400 font-medium">Modelo <span className="text-neutral-600 font-normal">(opcional)</span></label>
                            <input
                                type="text"
                                value={aiModel}
                                onChange={e => setAiModel(e.target.value)}
                                placeholder="llama-3.1-8b-instant  (padrão do Groq)"
                                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                            />
                        </div>

                        {/* AI Personality Context */}
                        <div className="space-y-1.5">
                            <label className="text-xs text-neutral-400 font-medium">Personalidade da IA</label>
                            <p className="text-[11px] text-neutral-600">Conte para a IA sobre sua conta — nicho, produtos, tom de voz, o que dizer e o que evitar.</p>
                            <textarea
                                value={aiContext}
                                onChange={e => setAiContext(e.target.value)}
                                placeholder={`Ex.: Somos uma loja de roupas femininas. Vendemos pelo site e entregamos em todo o Brasil. Nosso tom é simpático e direto. Se perguntarem o preço, peça para chamar no DM. Nunca prometa prazos de entrega exatos.`}
                                rows={4}
                                className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>

                        <button
                            onClick={handleSaveAiContext}
                            disabled={aiContextSaving}
                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                        >
                            {aiContextSaving ? 'Salvando...' : aiContextSaved ? 'Salvo ✓' : 'Salvar'}
                        </button>
                    </div>
                )}</details>
}
