# CEE Automação — contexto para o Claude

Sistema de automação do Instagram da **@cee_webstore** (CEE Store) + ferramentas para produzir e publicar conteúdo
de produtos. O dono não é programador: fale em português do Brasil, em linguagem simples, e nunca mostre chaves ou
tokens.

- **Comece pelo `GUIA.md`**: resumo do que existe, ordem das ferramentas e rotina semanal. Mantenha-o atualizado
  quando criar ou mudar uma ferramenta.
- Detalhes técnicos (infraestrutura, variáveis, migrações, testes): `README.md`.

## Ferramentas (skills em `.claude/skills/`)

1. `/pesquisar-produtos`: escolher produtos de afiliado (opcional).
2. `/semana-conteudo`: rotina principal. Produz a semana (Reels, Stories, carrosséis, combos, vitrine), uma aprovação,
   publicação automática pela agenda.
3. `/novo-post-produto`: carrossel avulso publicado na hora + regra de DM + vitrine.

## Regras fixas

- Publicar é público: sempre mostrar a prévia e pedir "ok" antes de publicar ou agendar.
- Nada inventado: só o que está no anúncio ou aparece nas fotos. Sem preço nas imagens.
- Produto **próprio** (vendido pela CEE Store na Amazon: termômetro B0HJYDZNSM, chave 8 em 1 B0HJHFKYBD, misturador
  B0HFDY9976): link normal, sem aviso de afiliado.
- Produto **de afiliado**: aviso "link de afiliado" na legenda; Amazon com `tag=ceestore01-20` ou link
  `link.amazon`/`amzn.to`. **Não usar fotos do anúncio da Amazon.** Na dúvida, pergunte se é próprio ou afiliado.
- Links de afiliado da Amazon nunca passam pelo encurtador `/r/` (`lib/links.ts`, `isAmazonAffiliateLink`).

## Ambiente

- Produção: https://cee-automacao.vercel.app (Vercel publica o branch `main`). Vitrine pública: `/links`.
- Scripts dos kits leem `AUTOMATION_API_KEY` do `.env.local` (computador) ou da variável de ambiente (nuvem).
- Pastas de trabalho fora do git: `carrossel/posts/`, `conteudo/semanas/`, `conteudo/musicas/`.
- Mudança de código: branch próprio → pull request → o dono aprova o merge no GitHub. Rode `npx tsc --noEmit` antes.
  Migrações SQL (`migrations/`) são rodadas pelo dono no SQL Editor do Supabase: evite quando der.
