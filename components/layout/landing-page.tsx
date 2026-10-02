"use client"

import { ArrowUpRight, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"

export function LandingPage() {
  const handleLogin = () => {
    // Instagram Business Login (Instagram API with Instagram Login). client_id must be the
    // Instagram app ID from the Instagram product page, not the parent Meta app ID.
    const params = new URLSearchParams({
      enable_fb_login: "0",
      force_authentication: "1",
      client_id: process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "",
      redirect_uri: process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "",
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    })
    window.location.href = `https://www.instagram.com/oauth/authorize?${params}`
  }

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
        <Button onClick={handleLogin} className="w-full">
          Conectar Instagram <ArrowUpRight className="size-4" />
        </Button>
      </div>
    </main>
  )
}
