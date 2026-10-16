"use client"

import { useEffect, useState } from "react"
import { Search, Loader2, UserCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/types/db"

interface ConversationListProps {
    userId: string
    selectedId: string | null
    onSelect: (id: string, username: string, recipientId: string) => void
}

export function ConversationList({ userId, selectedId, onSelect }: ConversationListProps) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!userId) return

        const fetchConversations = async () => {
            try {
                const res = await fetch(`/api/inbox/conversations?userId=${userId}`)
                const data = await res.json()
                if (Array.isArray(data)) {
                    setConversations(data)
                }
            } catch (error) {
                console.error("Failed to load conversations", error)
            } finally {
                setLoading(false)
            }
        }

        fetchConversations()
    }, [userId])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full border-r border-border bg-card w-full md:w-[350px]">
            <div className="p-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground mb-4">Conversas</h2>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        className="w-full bg-background border border-input rounded-xl pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                        placeholder="Buscar mensagens..."
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {conversations.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                        Nenhuma conversa ainda.
                    </div>
                ) : (
                    conversations.map((conv) => (
                        <div
                            key={conv.id}
                            onClick={() => onSelect(conv.id, conv.recipient_username, conv.recipient_id.toString())}
                            className={cn(
                                "p-3 rounded-lg flex items-center gap-3 cursor-pointer transition-colors border border-transparent",
                                selectedId === conv.id
                                    ? "bg-accent border-border"
                                    : "hover:bg-accent hover:border-border"
                            )}
                        >
                            <div className="w-12 h-12 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                                <UserCircle className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className={cn(
                                        "font-semibold text-sm truncate",
                                        selectedId === conv.id ? "text-accent-yellow-foreground dark:text-accent-yellow" : "text-foreground"
                                    )}>
                                        {conv.recipient_username}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {new Date(conv.last_message_at).toLocaleDateString("pt-BR", { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                    Toque para ver a conversa
                                </p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
