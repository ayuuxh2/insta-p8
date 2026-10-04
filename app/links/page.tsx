import type { Metadata } from "next"
import { agentUser } from "@/lib/agent"
import { groupVitrine, loadVitrine, vitrineHref } from "@/lib/vitrine"
import { VitrineList } from "./vitrine-list"

// Public "link da bio" page: every product advertised on @cee_webstore, numbered and grouped by category.
export const revalidate = 60

export const metadata: Metadata = {
  title: "Achadinhos da CEE Store",
  description: "Todos os produtos dos posts da @cee_webstore, com o link de cada um.",
  robots: { index: false },
}

export default async function LinksPage() {
  const { db, user } = await agentUser()
  const items = user ? (await loadVitrine(db, user.id)).items : []
  const groups = groupVitrine(items).map((g) => ({
    category: g.category,
    items: g.items.map((i) => ({
      number: i.number,
      title: i.title,
      emoji: i.emoji || "",
      href: vitrineHref(i),
      image: i.imagePath ? `/api/vitrine/img/${i.number}` : null,
      affiliate: i.affiliate === true,
    })),
  }))
  const hasAffiliate = groups.some((g) => g.items.some((i) => i.affiliate))

  return (
    <main className="min-h-dvh bg-[#F6F1E7] text-[#10222B]">
      <header className="bg-[#082736] px-4 pb-8 pt-8 text-center text-white">
        <img src="/brand/logo-dark.png" alt="CEE Store" className="mx-auto h-10" />
        <h1 className="mt-5 font-serif text-[28px] font-black leading-tight tracking-tight">
          Achadinhos da <span className="text-[#F2B134]">@cee_webstore</span>
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-white/80">
          Todos os produtos dos nossos posts. Viu o número no vídeo? Procure aqui embaixo.
        </p>
      </header>

      <VitrineList groups={groups} />

      <footer className="mx-auto max-w-2xl px-4 pb-12 pt-4 text-center text-xs leading-relaxed text-[#5B6B73]">
        <p>Prefere receber no direct? Comente a palavra do post que a gente te manda o link. 📩</p>
        {hasAffiliate && <p className="mt-2">Alguns links são de afiliado: podemos receber uma comissão pelas compras feitas por eles, sem custo extra para você.</p>}
        <p className="mt-2">Preços e disponibilidade são definidos por cada loja.</p>
        <a href="https://www.instagram.com/cee_webstore/" className="mt-4 inline-block font-semibold text-[#0D3B4F] underline">Seguir a @cee_webstore no Instagram</a>
      </footer>
    </main>
  )
}
