"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startInstagramLogin } from "@/lib/instagram-login"

// Warns the owner when the Instagram token stopped working (automations are down until reconnect).
export function ConnectionBanner({ userId }: { userId: string | null }) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetch(`/api/instagram/status?userId=${userId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data && data.ok === false) setBroken(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  if (!broken) return null

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm sm:px-8">
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1">
        <strong>A conexão com o Instagram caiu.</strong> As respostas automáticas estão paradas até você reconectar
        (acontece quando a senha é trocada ou o Instagram encerra a sessão).
      </p>
      <Button size="sm" onClick={startInstagramLogin}>Reconectar Instagram</Button>
    </div>
  )
}
