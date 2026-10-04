---
name: pesquisar-produtos
description: Pesquisa e ranqueia produtos para divulgar como afiliado da CEE Store (Amazon, Mercado Livre, Shopee) nos nichos cozinha/churrasco, ferramentas/utilidades, casa/organização e brinquedos — comissão estimada, demanda, avaliações e potencial de gancho — e entrega a lista para escolher o próximo post. Use quando o usuário pedir ideias de produtos, "o que postar", pesquisa de afiliados, achadinhos ou produtos em alta.
---

# Pesquisa de produtos de afiliado

Configuração (tag da Amazon, tabelas de comissão, nichos, critérios, links de mais vendidos):
**`afiliados/config.json`** — leia antes de começar. Fale com o usuário em português simples.

## Regras que não podem ser quebradas

- **Amazon: nada de robô.** A licença de Associados proíbe mineração/coleta automática no site da Amazon.
  Não raspe listas de mais vendidos da Amazon. O usuário abre as páginas (os links estão em
  `config.amazon.paginas_para_o_usuario`) e manda os links que achou interessantes; você analisa **um a um**.
- **Imagens da Amazon não vão para carrosséis** (a licença não permite baixar/alterar). Para os posts, use
  imagens do vendedor (Mercado Livre/Shopee, quando liberadas para divulgação) ou IA **apenas como cenário**.
- **Links:** Amazon = `https://www.amazon.com.br/dp/<ASIN>?tag=ceestore01-20` (montado automaticamente).
  Mercado Livre e Shopee: o usuário gera o link de afiliado no painel de cada programa (diga qual produto).
- **Divulgação:** todo post com link de afiliado identifica "link de afiliado" na legenda.
- Nunca invente nota, número de vendas ou comissão. Se não souber, diga "não informado".

## 1. Entender o pedido

Pergunte só o que faltar: nicho(s) (padrão: os de `config.nichos`), plataformas (padrão: as três), quantos
produtos na lista final (padrão: 10).

## 2. Coletar candidatos

**Mercado Livre** — abra as páginas de mais vendidos pelo navegador do usuário (Claude in Chrome:
`navigate` + `get_page_text`; páginas em `config.mercado_livre.mais_vendidos`; para Casa e Brinquedos, navegue
pelo menu de categorias da página de mais vendidos se o link direto não abrir). Leitura pontual de poucas páginas,
como uma visita normal — não fique varrendo. Colete: posição, título, preço atual, nota, "+N vendidos", frete grátis.

**Shopee** — se o usuário mandar a planilha do **Feed de produto** (painel de afiliados → Criativo → Feed de
produto), leia-a (CSV/XLSX) e use a comissão e o link que vierem nela. Se a Open API estiver liberada
(`config.shopee.open_api`), use-a. Sem nenhum dos dois, peça a planilha.

**Amazon** — peça ao usuário os links (ou ASINs) que ele separou nas páginas de mais vendidos/em alta. Para cada um,
leia a página do produto (firecrawl_scrape, uma por vez) para pegar título, categoria, preço, nota e nº de
avaliações. A comissão vem da tabela `config.amazon.comissao_por_categoria`.

## 3. Avaliar e ranquear

Para cada produto calcule:
- **Comissão estimada (R$)** = preço × taxa da categoria (ML: venda direta; Shopee: taxa total da planilha).
- **Demanda**: posição no ranking, "+N vendidos" / nº de avaliações.
- **Confiança**: nota ≥ `criterios.nota_min` e avaliações/vendas ≥ `criterios.avaliacoes_min`.
- **Faixa de preço**: entre `criterios.preco_min` e `criterios.preco_max` (fora disso, só se a comissão em R$ for
  muito boa — explique).
- **Potencial de post** (0–5, seu julgamento): resolve um problema visível? dá um gancho forte no estilo de
  `carrossel/referencias/capas.md`? funciona em foto? é "achadinho" que gera comentário?
- **Já postado?** Rode `node afiliados/postados.mjs` e descarte o que já tem regra/post.

Nota final sugerida: `comissão_R$ normalizada × 0,35 + demanda × 0,25 + confiança × 0,15 + potencial × 0,25`.
Descarte: nota < 4,3, produtos de risco (saúde com promessa, eletrônico sem marca com reclamações, réplicas),
alimentos no ML (0% de comissão).

## 4. Entregar

Salve `afiliados/pesquisas/<AAAA-MM-DD>.md` com a tabela completa e mostre no chat os **10 melhores**:

| # | Produto | Loja | Preço | Comissão | R$ por venda | Nota / vendas | Por que vale | Gancho sugerido |

Para cada um: link de afiliado (Amazon montado com a tag) ou "gere no painel do ML/Shopee", e de onde virão as
imagens (vendedor/IA). Termine perguntando qual vira post — e então siga com a skill **`/novo-post-produto`**,
passando o link e avisando que as imagens são do vendedor ou geradas por IA (só cenário).
