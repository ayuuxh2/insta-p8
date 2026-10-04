import { type NextRequest, NextResponse } from "next/server"
import { agentUser, isAgentAuthorized, unauthorized } from "@/lib/agent"
import { loadVitrine, upsertVitrineItems } from "@/lib/vitrine"

// Vitrine (link da bio) for automation agents.
// POST /api/agent/vitrine { items: [{ title, category, emoji?, link, imagePath?, affiliate? }] }
//   → adds or updates products (matched by link); returns their numbers.
//   imagePath: a JPEG uploaded with /api/agent/upload-url.
// GET /api/agent/vitrine → all products.
export async function POST(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { items } = await request.json().catch(() => ({}))
  if (!Array.isArray(items) || !items.length || items.length > 50) return NextResponse.json({ error: "Envie de 1 a 50 produtos" }, { status: 400 })
  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  if (items.some((i: any) => i.imagePath && !String(i.imagePath).startsWith(`${user.id}/posts/`))) {
    return NextResponse.json({ error: "Caminho de imagem inválido (use /api/agent/upload-url)" }, { status: 400 })
  }
  try {
    const saved = await upsertVitrineItems(db, user.id, items)
    return NextResponse.json({ ok: true, items: saved.map((i) => ({ number: i.number, title: i.title, category: i.category })) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 400 })
  }
}

export async function GET(request: NextRequest) {
  if (!isAgentAuthorized(request)) return unauthorized()
  const { db, user } = await agentUser()
  if (!user) return NextResponse.json({ error: "Nenhuma conta do Instagram conectada" }, { status: 400 })
  return NextResponse.json({ ok: true, ...(await loadVitrine(db, user.id)) })
}
