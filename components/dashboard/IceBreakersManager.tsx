"use client"

import { useState, useEffect } from "react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Plus, Trash2, Save, RefreshCw } from "lucide-react"
import { toast } from "sonner"

type IceBreakerRow = { id?: string; question: string; response: string }

export function IceBreakersManager() {
    const { userId, isLoading } = useInstagramSession()
    const [breakers, setBreakers] = useState<IceBreakerRow[]>([])
    const [saving, setSaving] = useState(false)
    const [fetching, setFetching] = useState(true)

    useEffect(() => {
        if (!userId) return
        fetch(`/api/ice-breakers?userId=${userId}`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setBreakers(data)
                setFetching(false)
            })
            .catch(err => {
                console.error(err)
                setFetching(false)
            })
    }, [userId])

    const handleAdd = () => {
        if (breakers.length >= 4) {
            toast.error("O Instagram permite no máximo 4 iniciadores de conversa")
            return
        }
        setBreakers([...breakers, { question: "", response: "" }])
    }

    const handleChange = (index: number, field: "question" | "response", value: string) => {
        const newBreakers = [...breakers]
        newBreakers[index] = { ...newBreakers[index], [field]: value }
        setBreakers(newBreakers)
    }

    const handleRemove = (index: number) => {
        setBreakers(breakers.filter((_, i) => i !== index))
    }

    const handleSave = async () => {
        if (!userId) return

        // Validation
        if (breakers.some(b => !b.question?.trim() || !b.response?.trim())) {
            toast.error("Preencha todos os campos")
            return
        }

        setSaving(true)
        try {
            const res = await fetch("/api/ice-breakers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, iceBreakers: breakers })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("Iniciadores de conversa salvos e sincronizados!")
            } else {
                toast.error("Não foi possível salvar")
            }
        } catch (e) {
            toast.error("Erro ao salvar")
        } finally {
            setSaving(false)
        }
    }

    if (isLoading) {
            return (
                <div className="p-10 flex justify-center">
                    <Loader2 className="animate-spin text-accent-yellow-foreground dark:text-accent-yellow" />
                </div>
            )
        }

        if (!userId) {
            return (
                <div className="space-y-6 max-w-2xl mx-auto">
                    <div className="text-center py-10 border border-border rounded-xl text-muted-foreground bg-card">
                        <p className="text-sm font-medium">Instagram não conectado</p>
                        <p className="text-xs mt-1">Conecte sua conta do Instagram para gerenciar os iniciadores de conversa.</p>
                    </div>
                </div>
            )
        }

        if (fetching && !breakers.length) {
            return (
                <div className="p-10 flex justify-center">
                    <Loader2 className="animate-spin text-accent-yellow-foreground dark:text-accent-yellow" />
                </div>
            )
        }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-semibold tracking-[-0.03em] text-foreground">Iniciadores de conversa</h2>
                    <p className="text-muted-foreground text-sm">
                        Perguntas que as pessoas veem quando começam uma conversa com você.
                    </p>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-primary text-primary-foreground hover:opacity-90 font-bold"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Salvar e sincronizar
                </Button>
            </div>

            <div className="space-y-4">
                {breakers.map((item, idx) => (
                    <div key={idx} className="bg-card border border-border p-4 rounded-xl space-y-3 relative group">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 space-y-3">
                                <div>
                                    <label className="text-xs text-muted-foreground font-semibold uppercase">Pergunta</label>
                                    <Input
                                        value={item.question}
                                        onChange={e => handleChange(idx, "question", e.target.value)}
                                        placeholder="Ex.: Quais são os preços?"
                                        className="bg-background border-input mt-1 focus-visible:ring-ring"
                                        maxLength={80}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground font-semibold uppercase">Resposta automática</label>
                                    <Textarea
                                        value={item.response}
                                        onChange={e => handleChange(idx, "response", e.target.value)}
                                        placeholder="A resposta que a pessoa vai receber..."
                                        className="bg-background border-input mt-1 focus-visible:ring-ring"
                                        rows={2}
                                    />
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemove(idx)}
                                aria-label="Remover iniciador de conversa"
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}

                {breakers.length === 0 && (
                    <div className="text-center py-10 border border-border rounded-xl text-muted-foreground bg-card">
                        Nenhum iniciador de conversa ainda. Adicione um para começar!
                    </div>
                )}

                {breakers.length < 4 && (
                    <Button
                        variant="outline"
                        onClick={handleAdd}
                        className="w-full border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="w-4 h-4 mr-2" /> Adicionar pergunta
                    </Button>
                )}
            </div>

            <div className="bg-muted border border-border p-4 rounded-xl flex gap-3 text-sm text-foreground">
                <RefreshCw className="w-5 h-5 shrink-0 text-muted-foreground" />
                <p>
                    As alterações feitas aqui são sincronizadas automaticamente com seu perfil do Instagram. Pode levar alguns minutos para aparecerem para todo mundo.
                </p>
            </div>
        </div>
    )
}
