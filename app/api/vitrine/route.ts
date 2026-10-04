import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { loadVitrine, saveVitrine } from "@/lib/vitrine"

// Dashboard management of the vitrine (link da bio).
// GET /api/vitrine?userId= — products with click counts.
// PATCH /api/vitrine?userId= { number, hidden?, title?, category? } — edits one product.

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId ausente" }, { status: 400 })
  const db = await getSupabaseServerClient()
  const { items } = await loadVitrine(db, userId)
  const codes = items.map((i) => i.shortCode).filter(Boolean) as string[]
  const clicks = new Map<string, number>()
  if (codes.length) {
    const { data } = await db.from("tracked_links").select("code, clicks").in("code", codes)
    for (const row of data || []) clicks.set(row.code, row.clicks || 0)
  }
  return NextResponse.json({
    items: items
      .sort((a, b) => b.number - a.number)
      .map((i) => ({ ...i, clicks: i.shortCode ? clicks.get(i.shortCode) ?? 0 : null })),
  })
}

export async function PATCH(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const body = await request.json().catch(() => ({}))
  if (!userId || !Number.isInteger(body.number)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
  const db = await getSupabaseServerClient()
  const vitrine = await loadVitrine(db, userId)
  const item = vitrine.items.find((i) => i.number === body.number)
  if (!item) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 })
  if (typeof body.hidden === "boolean") item.hidden = body.hidden
  if (typeof body.title === "string" && body.title.trim()) item.title = body.title.trim().slice(0, 80)
  if (typeof body.category === "string" && body.category.trim()) item.category = body.category.trim().slice(0, 30)
  item.updatedAt = new Date().toISOString()
  await saveVitrine(db, userId, vitrine)
  return NextResponse.json({ ok: true, item })
}
