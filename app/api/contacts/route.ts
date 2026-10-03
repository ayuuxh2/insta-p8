import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { applyContactFilters, filtersFromSearchParams } from "@/lib/contacts-query"
import { normalizeTags, deleteContactData } from "@/lib/contacts"

const PAGE_SIZE = 50

// GET /api/contacts?userId=&q=&tag=&follows=&status=&page= — list + summary numbers + known tags.
export async function GET(request: NextRequest) {
  const filters = filtersFromSearchParams(request.nextUrl.searchParams)
  if (!filters) return NextResponse.json({ error: "userId ausente" }, { status: 400 })
  const page = Math.max(0, Number(request.nextUrl.searchParams.get("page")) || 0)

  const db = await getSupabaseServerClient()
  const base = () => db.from("contacts").select("ig_id", { count: "exact", head: true }).eq("user_id", filters.userId)

  const [list, total, follows, notFollows, optedOut, tagRows] = await Promise.all([
    applyContactFilters(db.from("contacts_overview").select("*", { count: "exact" }), filters)
      .order("last_seen_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
    base(),
    base().eq("follows", true),
    base().eq("follows", false),
    base().eq("opted_out", true),
    db.from("contacts").select("tags").eq("user_id", filters.userId).neq("tags", "{}").limit(5000),
  ])

  if (list.error) {
    console.error("[contacts] list failed:", list.error.message)
    return NextResponse.json({ error: "Não foi possível carregar os contatos" }, { status: 500 })
  }

  const allTags = [...new Set((tagRows.data || []).flatMap((r: any) => r.tags || []))].sort()
  return NextResponse.json({
    contacts: list.data,
    filteredTotal: list.count || 0,
    pageSize: PAGE_SIZE,
    page,
    stats: {
      total: total.count || 0,
      follows: follows.count || 0,
      notFollows: notFollows.count || 0,
      optedOut: optedOut.count || 0,
    },
    tags: allTags,
  })
}

// PATCH /api/contacts { userId, igId, tags } — replaces a contact's tags.
export async function PATCH(request: NextRequest) {
  const { userId, igId, tags } = await request.json().catch(() => ({}))
  if (!userId || !igId || !Array.isArray(tags)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const clean = normalizeTags(tags)
  const { error } = await db.from("contacts").update({ tags: clean }).eq("user_id", userId).eq("ig_id", igId)
  if (error) return NextResponse.json({ error: "Não foi possível salvar as tags" }, { status: 500 })
  return NextResponse.json({ ok: true, tags: clean })
}

// DELETE /api/contacts?userId=&igId= — LGPD erasure of one person (contact, history, links, inbox).
export async function DELETE(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const igId = request.nextUrl.searchParams.get("igId")
  if (!userId || !igId) return NextResponse.json({ error: "Dados ausentes" }, { status: 400 })

  const db = await getSupabaseServerClient()
  await deleteContactData(db, userId, igId)
  return NextResponse.json({ ok: true })
}
