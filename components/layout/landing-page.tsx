"use client"

import { ArrowUpRight, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startInstagramLogin } from "@/lib/instagram-login"

export function LandingPage({ error }: { error?: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Conectar Instagram</h1>
          <p className="text-sm text-muted-foreground">
            Entre com a conta profissional autorizada para ativar as automações de comentário e DM.
          </p>
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button onClick={startInstagramLogin} className="w-full">
          Conectar Instagram <ArrowUpRight className="size-4" />
        </Button>
      </div>
    </main>
  )
}
