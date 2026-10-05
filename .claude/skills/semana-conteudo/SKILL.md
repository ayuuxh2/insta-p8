---
name: semana-conteudo
description: Produz e agenda uma semana inteira de conteúdo da @cee_webstore — Reels narrados com legenda feitos a partir de fotos, Stories e carrosséis — com regras de link na DM (comentário e resposta de Story), prévia para uma única aprovação e publicação automática nos horários. Use quando o usuário mandar fotos/links de produtos para a semana, pedir Reels, Stories, "conteúdo da semana", agenda de posts ou postagem automática.
---

# Semana de conteúdo (Reels + Stories + carrosséis agendados)

O usuário não grava vídeo nem quer gastar tempo com posts: ele manda **links e fotos** dos produtos uma vez por
semana, aprova a semana **uma vez** e o sistema publica sozinho. Fale em português do Brasil, linguagem simples.
Nunca mostre chaves ou tokens.

Ferramentas (pasta `conteudo/kit/`, documentação no topo de cada arquivo):

| Script | Faz |
|---|---|
| `reel.mjs <pasta>` | `reel.json` → `out/reel.mp4` (9:16, narração pt-BR, legenda palavra a palavra) + `out/capa.jpg` |
| `story.mjs <pasta>` | `stories.json` → `out/story-N.jpg` |
| `carrossel/kit/build.mjs <pasta>` | `carrossel.json` → `out/slide-N.jpg` (mesmo kit do /novo-post-produto) |
| `combo.mjs <pasta>` | `combo.json` → carrossel "combo": capa + Reels prontos em 4:5 + chamada (`out/slide-N.jpg/.mp4`) |
| `vitrine.mjs <semana> [--check | --listar]` | `vitrine.json` → produtos na página pública `/links` (link da bio), numerados |
| `previa.mjs <semana>` | `previa/dia-AAAA-MM-DD.jpg` (miniaturas por dia, para aprovação) |
| `agendar.mjs <semana> [--check]` | valida, envia e coloca na fila (`agenda.json`) |
| `agenda.mjs [--cancelar <id> \| --cancelar-lote <lote>]` | mostra/cancela a fila |

A fila é publicada por `/api/cron/publish` (pg_cron do Supabase a cada 5 min; GitHub Actions de reserva); no painel: **Agenda de posts**.

## Regras que não podem ser quebradas

- **Nada inventado.** Tudo que a narração, os títulos, a legenda ou a DM afirmam precisa estar no anúncio ou visível
  nas fotos. Sem preço no vídeo/imagem ("confira o preço no link"), sem promessas de saúde/resultado.
- **Afiliado:** legenda com "Link de afiliado: posso receber comissão por compras feitas pelo link". Links da
  Amazon com `?tag=ceestore01-20`. **Imagens da Amazon não podem ser usadas** — só fotos do usuário ou liberadas
  pelo vendedor. Produtos próprios (termômetro B0HJYDZNSM, chave 8 em 1 B0HJHFKYBD, misturador B0HFDY9976) não
  levam tag nem aviso.
- **Publicar é público:** só rode `agendar.mjs` (sem `--check`) depois do "ok" do usuário para a semana mostrada.
  Uma aprovação vale para aquele lote; mudanças grandes depois disso pedem nova aprovação.

## 1. Material

Pergunte só o que faltar: produtos da semana (link + fotos; 3 a 5 produtos), semana (padrão: próxima segunda) e se
mantém a grade padrão. Se o usuário não tiver produtos, ofereça `/pesquisar-produtos`.

Pasta: `conteudo/semanas/<AAAA-MM-DD da segunda>/` (fora do git) com `fotos/` (copie as fotos como
`<produto>-1.jpg`…; converta PNG/WEBP para JPG com `sharp`). Leia cada produto como no passo 1 do
`/novo-post-produto` (firecrawl com schema; se bloquear, peça os tópicos do anúncio). Abra cada foto (Read).

## 2. Grade padrão (conta nova, crescer alcance)

Por dia: **3 Reels** (12:00, 17:00 e 19:30; 09:30 como 4º horário se faltar espaço) e **4 Stories** (08:30 pergunta ·
11:00 produto · 15:00 o Reel do meio-dia em vídeo · 21:00 "Responda PALAVRA"). **Carrossel** seg/qua/sex às 18:00.
≈ 50 a 60 publicações/semana.
Espalhe os produtos para não repetir o mesmo produto em Reels seguidos. Varie os minutos (ex.: 12:07, 19:34)
para não parecer robô.

Com 3–5 produtos: cada produto rende **3 Reels com ângulos diferentes** (mesma palavra-chave, ganchos diferentes):
1. **Dor → solução** ("Ainda corta a carne pra ver o ponto?")
2. **Demonstração / benefícios** ("3 coisas que esse termômetro faz")
3. **Série / curiosidade / contraste** ("Da série: coisas que eu deveria ter comprado antes", "Achadinho de
   churrasqueiro que ninguém te conta")

Além desses três, cada produto ganha mais **2 Reels de formato fixo** (mesma palavra-chave):
4. **Passo a passo** (`-r4`): gancho "Como usar em 3 passos" + uma cena por passo com `kicker` "Passo 1", "Passo 2",
   "Passo 3" + CTA. Os passos vêm do anúncio ou do que as fotos mostram; sem isso, troque por outro formato e avise na
   prévia.
5. **Perguntas e respostas** (`-r5`): gancho "Respondendo as dúvidas sobre…" + 2 ou 3 pares de cenas, uma com
   `kicker` "Pergunta" (a dúvida no título, narrada como cliente) e outra com `kicker` "Resposta" (resposta curta) +
   CTA. Só perguntas cuja resposta está no anúncio ou nas fotos (ex.: "Precisa de pilha?", "Serve pra fritura?",
   "Vem com estojo?"). Nunca invente resposta; sem 2 perguntas respondíveis, troque por outro formato e avise.

O problema → solução já é o `-r1`. Com 5 produtos (25 Reels) não cabe tudo em 3 horários por dia: use o 4º horário
(09:30) ou deixe os `-r5` que sobrarem para a semana seguinte, e avise na prévia.

**Reels de teste (padrão):** o `-r1` de cada produto sai **normal**; o `-r2` ao `-r5` saem como **Reel de teste**
(`"trial": true` no `agenda.json`): o Instagram mostra só para quem não segue e, se for bem, passa para os seguidores
automaticamente. Serve para descobrir qual gancho atrai gente nova sem gastar os seguidores com versões fracas.
Reel de teste não aparece no perfil até ser promovido, por isso o Story de vídeo (15:00) usa sempre o Reel normal do
dia ou um que já saiu. Precisa de `migrations/009_reels_de_teste.sql` aplicada (sem ela, o agendamento do item de
teste falha com erro de coluna `trial`).

**Combo por categoria** (1 ou 2 por semana, às 18h num dia sem carrossel): capa com gancho da série +
o `-r1` de cada produto da categoria (2 a 8) + "Comente COMBO que eu te mando todos os links". `post.json` do combo
usa `links: [{ title: "🦖 Nome", url }]` no lugar de `link` (vai tudo numa DM só; mensagem ≤ 800 caracteres) e a
legenda lista os produtos com o número da vitrine ("— nº 4").

**Vitrine (link da bio):** todo produto da semana vai para `vitrine.json` (título curto, categoria, emoji, link,
foto própria ou do vendedor — nunca da Amazon, `affiliate`). Rode `vitrine.mjs` **antes** de escrever as legendas
dos combos para saber os números (`--listar`).

## 3. Pastas por item

```
conteudo/semanas/2026-10-12/
  fotos/
  agenda.json
  termometro-r1/   reel.json  post.json   (+ stories.json no primeiro Reel de cada produto)
  termometro-r2/   reel.json  post.json   (… até termometro-r5: passo a passo e perguntas e respostas)
  termometro-c/    carrossel.json  post.json
```

**`post.json`** — mesmo formato do `carrossel/kit/publish.mjs`: `caption`, `keywords` (1ª = palavra do vídeo),
`dmMessage`, `messageVariants`, `link`, `ruleName`, `tags`, `checkFollow` (true), `publicReplies`, `optinTitle`,
`optinButton`. Mesma palavra-chave para todos os itens do produto; legendas diferentes por Reel.

**`reel.json`** (formato no topo de `reel.mjs`): 5 a 7 cenas, **15 a 30 s** no total.
- Cena 1 `hook`: título = gancho (≤ 8 palavras, 1–3 em `*destaque*`), narração curta (≤ 2,5 s). Siga o estilo de
  `carrossel/referencias/capas.md` (voz de pessoa, curiosidade, humor, série).
- Cenas do meio: um benefício/fato por cena; título ≤ 6 palavras; narração 1 frase (8–16 palavras), falada como
  gente ("olha só", "sabe quando…"). Uma foto diferente por cena quando houver; ajuste `focus`/`zoom`.
- Última cena `cta`: narração "Comente PALAVRA que eu te mando o link no direct."
- Escreva números por extenso quando a voz puder ler errado ("menos cinquenta a trezentos graus").

**`stories.json`** (formato no topo de `story.mjs`): 1 `pergunta` (sem regra, só conversa), 1 `produto`,
1 `link` por produto. O Story de vídeo usa o próprio `out/reel.mp4`.

**`agenda.json`** (formato no topo de `agendar.mjs`): horário de Brasília. Reels `-r2`/`-r3` com `"trial": true`.
Story `pergunta` com `"rule": false`;
os outros Stories e posts usam o `post.json` da pasta (Stories viram regra de **resposta ao Story** com a mesma
palavra). `batch` = data da segunda.

## 4. Gerar e conferir

```bash
node conteudo/kit/reel.mjs conteudo/semanas/<semana>/<item>        # ~1 min por Reel
node conteudo/kit/story.mjs conteudo/semanas/<semana>/<item>
node carrossel/kit/build.mjs conteudo/semanas/<semana>/<item>
```

Confira cada Reel extraindo quadros (ffmpeg de `ffmpeg-static`: `-ss <t> -frames:v 1`) e abrindo (Read): texto
cortado, legenda sobre o rosto/produto, foto pixelada, título encostando no contador. Ajuste e gere de novo.
Abra cada Story e slide.

## 5. Aprovação (uma vez por semana)

```bash
node conteudo/kit/combo.mjs conteudo/semanas/<semana>/<combo>       # depois dos Reels
node conteudo/kit/vitrine.mjs conteudo/semanas/<semana> --check
node conteudo/kit/previa.mjs conteudo/semanas/<semana>
node conteudo/kit/agendar.mjs conteudo/semanas/<semana> --check
```

Envie ao usuário (SendUserFile): as imagens de `previa/`, 2 ou 3 Reels de amostra (`out/reel.mp4`) e um resumo:
quantos posts por dia, produtos, palavras-chave, os ganchos dos Reels e quais saem como teste. Pergunte se pode agendar.

## 6. Agendar

```bash
node conteudo/kit/vitrine.mjs conteudo/semanas/<semana>
node conteudo/kit/agendar.mjs conteudo/semanas/<semana>
node conteudo/kit/agenda.mjs
```

Diga quantos posts entraram na fila e que dá para acompanhar/cancelar no painel em **Agenda de posts**. Se algum
envio falhar no meio, rode de novo: os já agendados (`agenda.result.json`) são pulados.

## Problemas comuns

- `agenda` diz "FALHOU": o motivo aparece na linha; o sistema tenta 3 vezes e manda alerta (ntfy/e-mail).
- Falha de permissão de publicação: adicionar `instagram_business_content_publish` no app da Meta e reconectar.
- Narração falhou (sem internet/serviço fora): rode o `reel.mjs` de novo; a voz vem do serviço de leitura do Edge.
- Música: coloque faixas livres de direitos em `conteudo/musicas/` (sorteadas) ou `"music"` no `reel.json`.
