import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

// Owner-only (gated by proxy.ts). Reports whether each env var is present and well-formed
// without ever returning its value.
const CHECKS: Record<string, (v: string) => boolean> = {
  ADMIN_PASSWORD: v => v.length >= 12,
  SESSION_SECRET: v => v.length >= 32,
  ALLOWED_INSTAGRAM_USERNAMES: v => v.length > 0,
  NEXT_PUBLIC_SUPABASE_URL: v => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v),
  SUPABASE_SERVICE_ROLE_KEY: v => v.startsWith("sb_secret_") || v.startsWith("eyJ"),
  NEXT_PUBLIC_INSTAGRAM_APP_ID: v => /^\d{10,20}$/.test(v),
  INSTAGRAM_APP_ID: v => /^\d{10,20}$/.test(v),
  INSTAGRAM_APP_SECRET: v => /^[0-9a-f]{32}$/i.test(v),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: v => v.length >= 16,
  NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI: v => v === "https://cee-automacao.vercel.app/api/instagram/callback",
  CRON_SECRET: v => v.length >= 16,
  AUTOMATION_API_KEY: v => v.length >= 32,
  NTFY_TOPIC: v => v.length >= 12,
}

export async function GET() {
  const report = Object.entries(CHECKS).map(([name, isValid]) => {
    const raw = process.env[name]
    if (!raw) return { name, ok: false, problem: "ausente" }
    const value = raw.trim()
    const problems: string[] = []
    if (raw !== value) problems.push("espaços no início/fim")
    if (/^["']|["']$/.test(value)) problems.push("aspas")
    if (value.startsWith(name + "=")) problems.push("nome da variável dentro do valor")
    if (!isValid(value)) problems.push("formato inesperado")
    return {
      name,
      ok: problems.length === 0,
      length: value.length,
      ...(problems.length ? { problem: problems.join(", ") } : {}),
      // Lets the owner compare the deployed token with the local one without exposing it.
      ...(name === "INSTAGRAM_WEBHOOK_VERIFY_TOKEN"
        ? { sha256_prefix: createHash("sha256").update(value).digest("hex").slice(0, 8) }
        : {}),
    }
  })
  const sameAppId = process.env.INSTAGRAM_APP_ID?.trim() === process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID?.trim()
  return NextResponse.json({ instagram_app_ids_match: sameAppId, report })
}
