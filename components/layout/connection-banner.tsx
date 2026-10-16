"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startInstagramLogin } from "@/lib/instagram-login"

interface Status { ok: boolean; reason?: string; title?: string; action?: string }

// Warns the owner when Instagram access is down (automations stop until it is fixed).
export function ConnectionBanner({ userId }: { userId: string | null }) {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const check = () =>
      fetch(`/api/instagram/status?userId=${userId}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (!cancelled && data) setStatus(data) })
        .catch(() => {})
    void check()
    // Re-check every 5 minutes while the dashboard is open.
    const timer = setInterval(check, 5 * 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [userId])

  if (!status || status.ok) return null
  const blocked = status.reason === "api_blocked" || status.reason === "permission"

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm sm:px-8">
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1">
        <strong>{status.title}.</strong> As respostas automáticas estão paradas. {status.action}
      </p>
      {blocked ? (
        <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          Abrir painel da Meta <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <Button size="sm" onClick={startInstagramLogin}>Reconectar Instagram</Button>
      )}
    </div>
  )
}
