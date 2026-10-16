// Instagram connection health: is the stored token still able to call the API?

export type HealthReason = "token_invalid" | "api_blocked" | "permission" | "api_error" | "unreachable" | "not_connected"

export interface Health {
  ok: boolean
  reason?: HealthReason
  code?: number
  message?: string
}

/** Classifies a Graph API error. Only real outages count as "not ok" (network blips do not). */
export function classifyGraphError(error: any): Health {
  const code = Number(error?.code)
  const message = String(error?.message || "")
  if (code === 190) return { ok: false, reason: "token_invalid", code, message }
  if (code === 200 && /blocked|bloquead/i.test(message)) return { ok: false, reason: "api_blocked", code, message }
  if (code === 10 || code === 200 || code === 3) return { ok: false, reason: "permission", code, message }
  // Rate limits (4, 17, 32, 613) and temporary errors (1, 2) resolve on their own.
  return { ok: true, reason: "api_error", code, message }
}

export async function checkInstagramHealth(token: string | null | undefined): Promise<Health> {
  if (!token) return { ok: false, reason: "not_connected" }
  try {
    const res = await fetch("https://graph.instagram.com/v24.0/me?fields=user_id", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return data.error ? classifyGraphError(data.error) : { ok: true }
  } catch {
    return { ok: true, reason: "unreachable" }
  }
}

export const HEALTH_TEXT: Record<HealthReason, { title: string; action: string }> = {
  token_invalid: {
    title: "A conexão com o Instagram caiu",
    action: "Reconecte a conta no painel (acontece quando a senha é trocada ou o Instagram encerra a sessão).",
  },
  api_blocked: {
    title: "A Meta bloqueou o acesso do app à API",
    action: "Confira o app em developers.facebook.com (status e Caixa de Entrada de alertas) e avisos na conta do Instagram e do Facebook.",
  },
  permission: {
    title: "O app perdeu permissões no Instagram",
    action: "Confira no painel da Meta se a conta continua como Instagram Tester e reconecte a conta no painel.",
  },
  api_error: { title: "Erro na API do Instagram", action: "Veja Preferências → Diagnóstico." },
  unreachable: { title: "Instagram fora do ar", action: "Normalmente se resolve sozinho." },
  not_connected: { title: "Nenhuma conta do Instagram conectada", action: "Conecte a conta no painel." },
}
