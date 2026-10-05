# Guia da CEE Store — como usar tudo o que foi criado

Este é o ponto de partida. Se ficar perdido, volte aqui.

## 1. O que existe hoje (resumo)

O projeto `insta-p8` tem duas partes:

**A. O sistema (site na Vercel):** https://cee-automacao.vercel.app
Funciona sozinho, 24 horas por dia:

| O que faz | Onde ver |
|---|---|
| Alguém comenta a palavra no post → recebe o cartão "Quero receber" na DM → o sistema confere se segue a @cee_webstore → manda o link | Painel → **Respostas automáticas** |
| Publica sozinho os Reels, Stories e carrosséis agendados, nos horários, e cria a regra de DM de cada um | Painel → **Agenda de posts** |
| Publica parte dos Reels como **Reel de teste**: só quem não segue vê; se for bem, o Instagram mostra aos seguidores sozinho | Aparece como "Reel (teste)" na agenda |
| Página de links para a bio, com todos os produtos numerados | https://cee-automacao.vercel.app/links · Painel → **Vitrine** |
| Conversas, contatos, cliques, métricas | Painel → Conversas / Contatos / Métricas |
| Avisa se a conexão com o Instagram cair ou se a agenda parar | Alerta no celular/e-mail |

**B. As ferramentas do Claude (skills):** você pede, o Claude produz o conteúdo e manda para o sistema.

| Skill | Para quê | Quando usar |
|---|---|---|
| `/pesquisar-produtos` | Acha e ranqueia produtos para divulgar como afiliado (Amazon, Mercado Livre, Shopee): comissão, demanda, nota, gancho | Quando não sabe o que postar |
| `/semana-conteudo` | Produz **a semana inteira**: Reels narrados, Stories, carrosséis, combos, vitrine. Você aprova uma vez e tudo é publicado sozinho nos horários | **Rotina principal**, 1 vez por semana |
| `/novo-post-produto` | Faz **um carrossel avulso** e publica na hora, com a regra de DM | Produto que surgiu no meio da semana / post urgente |

## 2. Ordem lógica (a rotina)

```
 1. ESCOLHER     /pesquisar-produtos      (opcional: só se não tiver produtos em mente)
        ↓  você escolhe 3 a 5 produtos e gera os links de afiliado
 2. PRODUZIR     /semana-conteudo         (manda links + fotos de todos de uma vez)
        ↓  Claude mostra a prévia da semana inteira
 3. APROVAR      você responde "pode agendar"
        ↓  tudo entra na fila + produtos entram na Vitrine
 4. ACOMPANHAR   Painel → Agenda de posts / Métricas   (o sistema publica sozinho)

 Fora da rotina: /novo-post-produto  →  1 carrossel publicado na hora
```

## 3. Passo a passo para os próximos produtos

### Toda semana (ex.: domingo, 30 min do seu tempo)

1. **Separe 3 a 5 produtos.** Sem ideias? Abra um chat e digite `/pesquisar-produtos`.
2. **Para cada produto, pegue:**
   - **o link**
     - Produto **seu** (termômetro, chave 8 em 1, misturador): o link normal da Amazon.
     - **Afiliado Amazon:** use o botão "Compartilhar" da barra de Associados, que gera um link `link.amazon/...` ou um link com `tag=ceestore01-20`.
     - **Afiliado Mercado Livre/Shopee:** o link gerado no painel de afiliado.
   - **as fotos**
     - Produto seu: suas fotos.
     - Afiliado: fotos **suas** ou do vendedor do Mercado Livre/Shopee. **Fotos do anúncio da Amazon não podem** (regra do programa de Associados).
3. **Abra um chat novo** e digite `/semana-conteudo`. Mande:
   - os links e as fotos;
   - a semana (ex.: "semana de 12/10");
   - se cada produto é **seu** ou **de afiliado**.
4. **Confira a prévia** (imagens por dia + alguns Reels de amostra) e responda **"pode agendar"** ou peça ajustes.
5. **Pronto.** Durante a semana, só olhe o painel → **Agenda de posts** (se algo falhar, aparece ali e chega alerta).

### Produto avulso (fora da semana)

Chat novo → `/novo-post-produto <link>` + fotos + "é meu" ou "é afiliado". Confira a prévia e responda "pode publicar".

### Depois de publicar, confira

- Comente a palavra-chave com uma conta que **não segue** a loja: deve pedir para seguir antes do link.
- Abra https://cee-automacao.vercel.app/links e veja se o produto apareceu.

### Os 5 Reels de cada produto

| Reel | Formato | Como sai |
|---|---|---|
| 1º | Problema → solução | Normal |
| 2º | Demonstração / benefícios | Teste |
| 3º | Série / curiosidade | Teste |
| 4º | **Passo a passo** ("Passo 1, 2, 3") | Teste |
| 5º | **Perguntas e respostas** (só dúvidas que o anúncio responde) | Teste |

São 3 Reels por dia (12:00, 17:00 e 19:30). Com 5 produtos não cabe tudo: o Claude usa um 4º horário (09:30) ou
deixa os que sobrarem para a semana seguinte, e avisa na prévia.

### Reels de teste

O 1º Reel de cada produto sai normal (perfil + seguidores); do 2º ao 5º saem como
**Reel de teste**: o Instagram mostra só para quem **não segue**. Se o Reel for bem, ele é mostrado aos seguidores
automaticamente. Quem não segue e comenta a palavra cai na trava "siga para receber o link", então o teste também
traz seguidores. Reel de teste não aparece no perfil até ser promovido.

## 4. Regras que valem sempre

- **Afiliado = avisar na legenda** ("Link de afiliado: posso receber comissão por compras feitas pelo link").
  Produto próprio não leva aviso.
- **Fotos da Amazon não podem ser usadas em produto de afiliado.**
- **Nada inventado** nos posts: só o que está no anúncio ou aparece nas fotos. Sem preço na imagem.
- **Publicar é público:** o Claude sempre mostra a prévia e pergunta antes.
- Links de afiliado da Amazon vão **direto** para a Amazon (sem o link curto `/r/` do sistema), como a Amazon exige.
  Os outros links passam pelo `/r/` para contar cliques.

## 5. Onde rodar os chats

| Onde | Funciona? | Observação |
|---|---|---|
| **Claude Code no computador** (pasta `insta-p8`) | ✅ Tudo | Usa o arquivo `.env.local` com as senhas. Melhor para `/semana-conteudo` (gera vídeos) |
| **Claude Code na nuvem** (web/celular) | ✅ Publicar e agendar | A senha `AUTOMATION_API_KEY` está nas configurações do ambiente. As fontes dos slides podem sair diferentes |

**Um chat por tarefa.** Abra um chat novo para cada semana ou produto: o Claude lê este guia e o `CLAUDE.md`
sozinho, então não precisa explicar tudo de novo. Chats antigos podem ser arquivados: tudo que foi feito
está salvo no projeto (GitHub).

## 6. Quando o Claude muda o sistema (código)

As mudanças de código ficam num "pedido" no GitHub. Para elas entrarem no ar: abra o link que o Claude mandar →
**Merge pull request** → **Confirm merge**. A Vercel publica sozinha em 1–2 minutos.

## 7. Histórico (o que foi construído)

| Quando | O quê |
|---|---|
| 02–03/10 | Sistema de respostas automáticas: trava de seguidor, anti-spam, contatos, arquivos, links rastreados, métricas, LGPD, alertas |
| 03/10 | Kit de carrossel + `/novo-post-produto` (publica pela API) |
| 04/10 | `/pesquisar-produtos`; links de afiliado da Amazon direto na DM |
| 04/10 | `/semana-conteudo`: Reels narrados, Stories, agenda automática (Supabase a cada 5 min) |
| 04/10 | Vitrine (link da bio), combos por categoria, carrossel com vídeos |
| 05/10 | Posts do termômetro (PONTO) e do kit alicate (ALICATE); `link.amazon` reconhecido como afiliado; produto entra na Vitrine já no primeiro Story |
| 05/10 | Reels de teste (só para quem não segue, promoção automática) na `/semana-conteudo` |
| 05/10 | Mais 2 Reels por produto: passo a passo e perguntas e respostas |

Detalhes técnicos: `README.md`.
