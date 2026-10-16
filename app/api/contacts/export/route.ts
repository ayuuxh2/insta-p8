import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { applyContactFilters, filtersFromSearchParams, EVENT_LABELS } from "@/lib/contacts-query"

const MAX_ROWS = 20_000
const BATCH = 1000

// Brazilian Excel expects ";" as separator and a BOM to read UTF-8 accents.
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  // Excel treats cells starting with these characters as formulas.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

// GET /api/contacts/export?userId=&q=&tag=&follows=&status= — CSV download with the current filters.
export async function GET(request: NextRequest) {
  const filters = filtersFromSearchParams(request.nextUrl.searchParams)
  if (!filters) return NextResponse.json({ error: "userId ausente" }, { status: 400 })

  const db = await getSupabaseServerClient()
  const rows: any[] = []
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { data, error } = await applyContactFilters(db.from("contacts_overview").select("*"), filters)
      .order("last_seen_at", { ascending: false })
      .range(from, from + BATCH - 1)
    if (error) return NextResponse.json({ error: "Não foi possível exportar" }, { status: 500 })
    rows.push(...(data || []))
    if (!data || data.length < BATCH) break
  }

  const header = ["usuario", "perfil", "segue", "status", "tags", "ultima_palavra_chave", "ultimo_evento", "interacoes", "primeiro_contato", "ultimo_contato", "id_instagram"]
  const lines = rows.map((c) =>
    [
      c.username || "",
      c.username ? `https://instagram.com/${c.username}` : "",
      c.follows === true ? "sim" : c.follows === false ? "não" : "não verificado",
      c.opted_out ? "saiu da lista" : "ativo",
      (c.tags || []).join(", "),
      c.last_keyword || "",
      EVENT_LABELS[c.last_event] || c.last_event || "",
      c.interactions ?? "",
      formatDate(c.first_seen_at),
      formatDate(c.last_seen_at),
      c.ig_id,
    ]
      .map(csvCell)
      .join(";"),
  )

  const csv = "﻿" + [header.join(";"), ...lines].join("\r\n")
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contatos-cee-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
