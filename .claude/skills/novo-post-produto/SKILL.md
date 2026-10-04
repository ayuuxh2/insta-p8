---
name: novo-post-produto
description: Cria e publica no Instagram da @cee_webstore um carrossel de produto (capa com gancho + slides de benefícios + chamada "Comente PALAVRA"), com legenda, e cria no sistema CEE Automação a regra que envia o link na DM só para seguidores. Use quando o usuário mandar o link de um produto (Amazon, Shopee, Mercado Livre, loja própria…) e/ou fotos do produto pedindo post, carrossel ou automação de link.
---

# Novo post de produto (carrossel + regra de link para seguidores)

Entrada: **link do produto** e **fotos** (anexadas na conversa ou caminhos de arquivo). Saída: carrossel publicado
no Instagram com legenda + regra no sistema (comentário com a palavra → cartão "Quero receber" → checagem de
seguidor → link na DM).

Fale com o usuário em português do Brasil, em linguagem simples. Nunca mostre chaves ou tokens.

## 0. Pasta do post

Crie `carrossel/posts/<AAAA-MM-DD>-<produto-em-slug>/` (ignorada pelo git) e copie as fotos para lá como
`foto-1.jpg`, `foto-2.jpg`… (fotos anexadas na conversa ficam na pasta de imagens da sessão; converta PNG/WEBP para
JPG com `sharp` se precisar).

## 1. Ler o produto

- Use `firecrawl_scrape` no link com `formats: ["json"]` e um schema com: `title`, `brand`, `price`,
  `bullet_points` (lista), `description`, `specs` (pares nome/valor), `rating`, `review_count`.
- Se a página vier bloqueada (captcha/"robot check"), vazia ou incompleta, **peça ao usuário para colar o título e os
  tópicos do anúncio**. Não siga sem informação real.
- **Nunca invente características.** Tudo que for afirmado nos slides, na legenda ou na DM precisa estar no anúncio
  ou ser visível nas fotos. Sem promessas de saúde/resultado, sem "o melhor do Brasil", sem preço nos slides
  (preço muda; na legenda use "confira o preço no link").
- **Link de afiliado (Amazon, Shopee, Mercado Livre…): sempre identifique na legenda**, ex.: "Link de afiliado:
  posso receber comissão por compras feitas pelo link" (Amazon Associados exige a divulgação; o CONAR também).
  Pergunte ao usuário se o link é de afiliado quando não for óbvio (tag `tag=` da Amazon, `amzn.to`, `s.shopee`,
  `mercadolivre.com/sec`).
- Links da Amazon são enviados na DM **sem** o encurtador `/r/` do sistema (a política da Amazon proíbe esconder o
  destino); use o link do SiteStripe (`amzn.to/…` ou o link longo com `tag=`). Os cliques aparecem no painel de
  Associados, não nas métricas do sistema.

## 2. Analisar as fotos

Abra cada foto (Read). Anote: resolução, o que aparece, onde o produto está no quadro. Escolha a melhor foto de
estilo de vida (pessoa/ambiente) para a capa e fotos de detalhe para os slides de destaque. Com foto pequena
(menos de 1080 px), evite `zoom` acima de 1.5 para não pixelar.

## 3. Escrever os textos

Leia `carrossel/referencias/capas.md` antes de escrever o gancho.

**Capa (gancho):** voz de pessoa, não de loja; curiosidade que obriga a arrastar; humor, exclusividade ou contraste
quando combinar com o produto. Até ~10 palavras em 2–4 linhas, com 1 a 3 palavras em `*destaque*`. Crie 3 opções,
escolha a mais forte para o slide e mostre as outras duas ao usuário na prévia. `kicker` com 2–4 palavras;
`subtitle` com até 15 palavras.

**Sequência (5 a 7 slides; máximo 10):**

| # | tipo | conteúdo | limites |
|---|---|---|---|
| 1 | `cover` | gancho | acima |
| 2 | `feature` | o problema / a dor (`badge`: "O problema") | título ≤ 7 palavras, texto ≤ 28 |
| 3 | `feature` | o produto como solução (`badge`: "A solução") | idem |
| 4 | `steps` ou `feature` | como usar (3 passos) ou um diferencial | passo: título ≤ 5, texto ≤ 9 |
| 5 | `benefits` | 3–4 benefícios reais do anúncio | item: título ≤ 4, texto ≤ 9 |
| 6 | `cta` | "Quer o seu?" + palavra | — |

**Palavra-chave:** uma palavra de 3 a 8 letras ligada ao produto (ex.: FIO, KIT, LUZ, CAFÉ), fácil de digitar,
sem acento de preferência. Vai em `carrossel.json.keyword`, em `post.json.keywords[0]` e na legenda.

**Legenda** (até ~1.200 caracteres): linha de gancho; 2–4 linhas curtas de benefícios; chamada
"Comente <PALAVRA> que eu te mando o link no direct 📩 (exclusivo para quem segue a @cee_webstore)"; 3–6 hashtags
relevantes.

**DM** (`dmMessage`): curta e simpática, cita o produto; o link é colocado no final automaticamente. Escreva 1 variação
em `messageVariants`. Personalize o cartão: `optinTitle` (ex.: "Quer o link do afiador? 🔪"), `optinButton`
(≤ 20 caracteres). `tags`: produto + categoria. `publicReplies`: 3 frases curtas.

## 4. Montar os arquivos e gerar os slides

`carrossel.json` (formato documentado no topo de `carrossel/kit/build.mjs`; textos aceitam `*destaque*` e `\n`) e
`post.json` (formato no topo de `carrossel/kit/publish.mjs`). Depois:

```bash
node carrossel/kit/build.mjs carrossel/posts/<pasta>
node carrossel/kit/preview.mjs carrossel/posts/<pasta>
```

Abra **cada slide** (Read) e confira: texto cortado ou encostando em outro elemento, quebra de linha feia, foto mal
enquadrada, produto fora do quadro. Ajuste `titleSize`, `focus` ("x% y%"), `zoom`, ou encurte o texto, e gere de novo
até ficar bom.

## 5. Conferir antes de publicar

```bash
node carrossel/kit/publish.mjs carrossel/posts/<pasta> --check
```

Valida a pasta, a conexão com o Instagram e a permissão de publicação, sem publicar nada. Se falhar por permissão,
explique ao usuário: no app da Meta (developers.facebook.com → app → Casos de uso → Personalizar → Permissões), adicionar
`instagram_business_content_publish` e depois reconectar a conta no painel do sistema.

Envie ao usuário (SendUserFile) a `preview.jpg` e os slides, junto com: as 2 opções extras de gancho, a legenda
completa, a palavra-chave e a mensagem da DM. **Pergunte se pode publicar** — publicar é público. Só pule a
confirmação se, no pedido atual, o usuário disse explicitamente para publicar direto sem revisar.

## 6. Publicar e criar a regra

```bash
node carrossel/kit/publish.mjs carrossel/posts/<pasta>
```

O script envia os slides, publica o carrossel com a legenda e cria a regra (comentário com a palavra → "Quero receber"
→ só seguidores → link). Informe ao usuário o link do post (`result.json`) e o nome da regra, e sugira testar comentando
a palavra com uma conta que não segue a loja. Se a publicação falhar no meio, diga exatamente o que já foi feito
(o post pode ter sido publicado sem a regra — nesse caso a regra pode ser criada no painel, no post certo).
