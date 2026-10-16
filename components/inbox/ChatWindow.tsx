"use client"

import { useEffect, useState, useRef } from "react"
import { Send, Loader2, MoreVertical, Phone, Video, Zap, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { Message } from "@/types/db"

interface ChatWindowProps {
    conversationId: string | null
    recipientId?: string
    recipientName: string | null
    userId: string
    onBack?: () => void
}

export function ChatWindow({ conversationId, recipientId, recipientName, userId, onBack }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [inputText, setInputText] = useState("")
    const [sending, setSending] = useState(false)
    const [isAutomationOpen, setIsAutomationOpen] = useState(false)
    const [automations, setAutomations] = useState<any[]>([])
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!conversationId) return

        const fetchMessages = async () => {
            setLoading(true)
            try {
                const res = await fetch(`/api/inbox/messages?conversationId=${conversationId}`)
                const data = await res.json()
                if (Array.isArray(data)) {
                    setMessages(data)
                }
            } catch (error) {
                console.error("Failed to load messages", error)
            } finally {
                setLoading(false)
            }
        }

        fetchMessages()
    }, [conversationId])

    // Fetch automations for quick reply
    useEffect(() => {
        if (userId) {
            fetch(`/api/automations?userId=${userId}`).then(res => res.json()).then(data => {
                if (Array.isArray(data)) setAutomations(data)
            })
        }
    }, [userId])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    const handleSendMessage = async (text: string = inputText) => {
        if (!text.trim() || !recipientId || !userId) return

        setSending(true)
        try {
            const res = await fetch("/api/inbox/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    recipientId,
                    message: text
                })
            })

            if (res.ok) {
                setInputText("")
                // Optimistic update
                const newMsg: Message = {
                    id: `temp_${Date.now()}`,
                    conversation_id: conversationId!,
                    user_id: userId,
                    sender_id: "me",
                    sender_username: "Eu",
                    content: text,
                    is_from_instagram: false,
                    created_at: new Date().toISOString()
                }
                setMessages(prev => [...prev, newMsg])
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || "Não foi possível enviar a mensagem.", { duration: 8000 })
            }
        } catch (e) {
            console.error("Send failed", e)
            toast.error("Sem conexão. Verifique sua internet e tente de novo.")
        } finally {
            setSending(false)
            setIsAutomationOpen(false)
        }
    }

    if (!conversationId) {
        return (
            <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center bg-card h-full">
                <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center">
                    <Send className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Suas conversas</h3>
                    <p className="text-muted-foreground text-sm max-w-xs mx-auto mt-2">
                        Escolha uma conversa à esquerda para falar ao vivo com seus clientes.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-card relative">
            {/* Header */}
            <div className="h-16 border-b border-border flex items-center justify-between px-4 md:px-6 bg-card shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Voltar" className="md:hidden -ml-2 text-muted-foreground">
                            <ChevronLeft className="w-6 h-6" />
                        </Button>
                    )}
                    <div className="w-8 h-8 rounded-full bg-muted border border-border shrink-0" />
                    <div className="min-w-0">
                        <h3 className="font-bold text-foreground text-sm truncate">@{recipientName}</h3>
                        <span className="hidden md:flex items-center gap-1.5 text-[10px] text-success">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            Online pelo Instagram
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hidden md:flex" aria-label="Ligar"><Phone className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hidden md:flex" aria-label="Chamada de vídeo"><Video className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Mais opções"><MoreVertical className="w-4 h-4" /></Button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6">
                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isMe = !msg.is_from_instagram
                        return (
                            <div key={msg.id} className={cn("flex w-full", isMe ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                    "max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm break-words",
                                    isMe
                                        ? "bg-primary text-primary-foreground rounded-br-none"
                                        : "bg-muted text-foreground rounded-bl-none border border-border"
                                )}>
                                    {msg.content}
                                    <div className={cn(
                                        "text-[10px] mt-1 opacity-70",
                                        isMe ? "text-primary-foreground/70 text-right" : "text-muted-foreground"
                                    )}>
                                        {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
                <div ref={bottomRef} />
            </div>

            {/* Automation Popup */}
            {isAutomationOpen && (
                <div className="absolute bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-popover border border-border rounded-xl shadow-lg p-2 z-50">
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Respostas rápidas</div>
                    <div className="max-h-60 overflow-y-auto space-y-1">
                        {automations.map(auto => (
                            <button
                                key={auto.id}
                                onClick={() => handleSendMessage(auto.response_content?.message || auto.name)}
                                className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm text-popover-foreground transition-colors flex items-center gap-2"
                            >
                                <Zap className="w-3 h-3 text-accent-yellow-foreground dark:text-accent-yellow" />
                                <span className="truncate">{auto.name}</span>
                            </button>
                        ))}
                        {automations.length === 0 && (
                            <div className="px-3 py-4 text-center text-muted-foreground text-xs">Nenhuma automação encontrada.</div>
                        )}
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="p-3 md:p-4 border-t border-border bg-card shrink-0">
                <div className="flex items-center gap-2 bg-muted rounded-xl border border-border p-1.5 focus-within:border-accent-yellow focus-within:ring-2 focus-within:ring-accent-yellow/30 transition-all">
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setIsAutomationOpen(!isAutomationOpen)}
                        aria-label="Mostrar respostas rápidas"
                        className={cn(
                            "h-9 w-9 hover:bg-accent text-muted-foreground hover:text-accent-yellow-foreground dark:hover:text-accent-yellow transition-colors shrink-0",
                            isAutomationOpen && "text-foreground bg-accent"
                        )}
                    >
                        <Zap className="w-5 h-5" />
                    </Button>
                    <input
                        className="flex-1 bg-muted px-3 py-2 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground min-w-0"
                        placeholder="Digite uma mensagem..."
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !sending) {
                                e.preventDefault()
                                handleSendMessage()
                            }
                        }}
                        disabled={sending}
                    />
                    <Button
                        onClick={() => handleSendMessage()}
                        disabled={sending || !inputText.trim()}
                        size="icon"
                        aria-label="Enviar mensagem"
                        className="h-9 w-9 bg-primary text-primary-foreground hover:opacity-90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                </div>
            </div>
        </div>
    )
}
