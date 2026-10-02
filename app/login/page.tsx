"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BrandLogo } from "@/components/brand-logo"

function LoginForm() {
  const searchParams = useSearchParams()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Não foi possível entrar")
        return
      }
      // Only allow same-site relative redirects.
      const next = searchParams.get("next")
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-4 text-center">
        <BrandLogo className="mx-auto h-12" />
        <div>
          <h1 className="text-base font-semibold">Painel de automação</h1>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> Acesso restrito ao dono da conta
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || !password}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <Suspense fallback={<Loader2 className="size-6 animate-spin text-muted-foreground" />}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
