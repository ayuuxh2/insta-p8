"use client"

import { useMemo, useState } from "react"

type Item = { number: number; title: string; emoji: string; href: string; image: string | null; affiliate: boolean }
type Group = { category: string; items: Item[] }

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function VitrineList({ groups }: { groups: Group[] }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = normalize(query.trim().replace(/^n[ºo°]?\s*/i, ""))
    return groups
      .filter((g) => !category || g.category === category)
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => !q || String(i.number) === q || normalize(i.title).includes(q)),
      }))
      .filter((g) => g.items.length)
  }, [groups, query, category])

  if (!groups.length) {
    return <p className="px-4 py-16 text-center text-sm text-[#5B6B73]">Em breve, os achadinhos dos nossos posts aparecem aqui.</p>
  }

  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="sticky top-0 z-10 -mx-4 bg-[#F6F1E7]/95 px-4 pb-3 pt-4 backdrop-blur">
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procure pelo número ou pelo nome"
          aria-label="Procurar produto pelo número ou pelo nome"
          className="h-12 w-full rounded-xl border border-[#0D3B4F]/15 bg-white px-4 text-base text-[#10222B] outline-none placeholder:text-[#5B6B73] focus:border-[#0D3B4F]"
        />
        {groups.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Categorias">
            {[null, ...groups.map((g) => g.category)].map((c) => (
              <button
                key={c || "todas"}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${category === c ? "bg-[#0D3B4F] text-white" : "bg-white text-[#0D3B4F]"}`}
              >
                {c || "Todos"}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && <p className="py-12 text-center text-sm text-[#5B6B73]">Nenhum produto encontrado. Confira o número no post.</p>}

      {filtered.map((g) => (
        <section key={g.category} className="mt-4">
          <h2 className="mb-3 font-serif text-xl font-black text-[#0D3B4F]">{g.category}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {g.items.map((i) => (
              <li key={i.number}>
                <a
                  href={i.href}
                  target="_blank"
                  rel={i.affiliate ? "sponsored noopener" : "noopener"}
                  className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition-transform active:scale-[0.98]"
                >
                  <div className="relative aspect-square bg-[#EDE6D8]">
                    {i.image ? <img src={i.image} alt="" loading="lazy" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-4xl">{i.emoji || "🛍️"}</span>}
                    <span className="absolute left-2 top-2 rounded-full bg-[#F2B134] px-2.5 py-1 text-xs font-extrabold text-[#082736]">nº {i.number}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <p className="flex-1 text-sm font-semibold leading-snug">{i.emoji ? `${i.emoji} ` : ""}{i.title}</p>
                    <span className="mt-3 rounded-lg bg-[#0D3B4F] py-2 text-center text-sm font-bold text-white">Ver na loja</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
