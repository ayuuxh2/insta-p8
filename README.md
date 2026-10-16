# CEE Automação

Respostas automáticas para o Instagram da **@cee_webstore**: comentário com palavra-chave → DM → (só para
seguidores) → entrega de link ou arquivo. Alternativa própria e gratuita ao ManyChat.

Baseado no projeto open source [InstaAuto / insta-p8](https://github.com/ayuuxh2/insta-p8) (licença MIT), com
segurança, fluxo, anti-spam, contatos, arquivos e métricas reescritos.

## Como funciona

1. Alguém comenta a palavra-chave num post.
2. O comentário recebe uma resposta pública (frases sorteadas) e a pessoa recebe na DM um cartão com o botão
   **"Quero receber"** (ou, se a regra estiver em "Enviar direto", uma única mensagem).
3. Ao tocar, a conversa é aberta. Se a regra for **só para seguidores**, o sistema verifica se a pessoa segue a conta:
   segue → recebe o conteúdo; não segue → recebe "Seguir" + "Já segui ✅" (sem confirmação, nunca entrega).
4. Links e arquivos vão como links curtos (`/r/<código>`) próprios de cada pessoa, para contar os cliques.

Proteções: atraso aleatório, variações de texto, nunca responde duas vezes ao mesmo evento, limite de 700 respostas
privadas por hora (fila para o excedente), **SAIR / VOLTAR** e **EXCLUIR MEUS DADOS** pela DM.

## Telas do painel

| Tela | Para quê |
|---|---|
| Início | Resumo dos últimos 30 dias e atividade recente |
| Respostas automáticas | Criar regras (formulário rápido ou editor completo) |
| Conversas | Caixa de entrada das DMs |
| Contatos | Quem interagiu, tags, histórico, exportar CSV, excluir dados |
| Arquivos | Materiais enviados pelas regras (privados, até 50 MB) |
| Agenda de posts | Reels, carrosséis e Stories agendados: status, link do post publicado e cancelar |
| Iniciadores de conversa | Perguntas exibidas quando alguém abre a conversa |
| Métricas | Funil do comentário ao clique, por dia e por regra |
| Preferências | Informações do negócio (IA) e **Diagnóstico** (o que aconteceu com cada evento) |

## Infraestrutura (planos gratuitos)

- **Vercel**: site, webhook e rotina diária (`vercel.json`, 1x/dia: renova o token do Instagram, limpa dados antigos e
  mantém o Supabase ativo).
- **GitHub Actions**: checa a conexão a cada 30 min (`health-check.yml`) e é reserva da agenda
  (`publicar-agenda.yml`), ambos com o secret `CRON_SECRET` do repositório. O GitHub atrasa agendamentos em horas,
  por isso a agenda é disparada a cada 5 min pelo pg_cron do Supabase (`migrations/008_agendador_pg_cron.sql`).
- **Supabase**: banco Postgres e armazenamento privado de arquivos.
- **Meta**: app com "Instagram API with Instagram Login"; a @cee_webstore é Instagram Tester; app publicado (Live).

## Variáveis de ambiente

Veja `.env.example`. Valores secretos ficam só no `.env.local` (ignorado pelo git) e na Vercel.

| Variável | Observação |
|---|---|
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Login do painel (senha ≥ 12, segredo ≥ 32 caracteres) |
| `ALLOWED_INSTAGRAM_USERNAMES` | Contas que podem ser conectadas (`cee_webstore`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `NEXT_PUBLIC_INSTAGRAM_APP_ID`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | App da Meta (Instagram app ID/secret) |
| `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` | `https://<domínio>/api/instagram/callback` |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | O mesmo token cadastrado no webhook da Meta |
| `CRON_SECRET` | Protege a rotina diária |

Em **Preferências → Diagnóstico** e em `/api/admin/config-check` (com login) dá para conferir se tudo está certo
sem expor valores.

## Banco de dados

Instalação nova: rode `schema.sql` no SQL Editor do Supabase. Para atualizar uma instalação existente, rode em
ordem os arquivos de `migrations/` que ainda não foram aplicados (todos podem ser rodados de novo sem problema):

1. `003_etapa3_antispam.sql`
2. `004_etapa4_contatos.sql`
3. `005_etapa5_arquivos_links.sql`
4. `006_etapa7_registro.sql`
5. `007_agenda_publicacoes.sql`
6. `008_agendador_pg_cron.sql` (troque `<CRON_SECRET>` antes de rodar)
7. `009_reels_de_teste.sql`

## Conteúdo automático (Reels, Stories, carrosséis)

A skill `/semana-conteudo` gera a semana a partir de fotos (Reels narrados com legenda, Stories e carrosséis),
mostra uma prévia para aprovação e coloca tudo na fila (`scheduled_posts`). Scripts em `conteudo/kit/` (cada um
documentado no topo); a fila é publicada por `/api/cron/publish`, que também cria a regra de link de cada post
(comentário) ou Story (resposta).

## Desenvolvimento local (Windows)

```bash
npm.cmd install
npm.cmd run dev
```

O login do Instagram e o webhook só funcionam com HTTPS público (Vercel). Localmente dá para testar o painel e
enviar eventos simulados assinados com o `INSTAGRAM_APP_SECRET` para `/api/instagram/webhook`.

## Testes automáticos

`scripts/testes/run.mjs` repete os principais cenários (segurança, comentário → trava de seguidor, duplicados,
SAIR/VOLTAR, contatos/CSV, métricas, arquivos e links, API de agente, LGPD) contra um build local, usando o
Supabase real com ids falsos e apagando tudo no final. Rode antes de publicar mudanças:

```bash
npm.cmd run build
```

Em um terminal (PowerShell): `$env:ADMIN_PASSWORD="teste-local-123456"; npx.cmd next start -p 3400`
Em outro: `$env:TEST_ADMIN_PASSWORD="teste-local-123456"; node scripts/testes/run.mjs`

## Backup

Preferências → **Baixar backup (.json)**: regras, contatos, histórico, conversas, lista de arquivos e links (sem o
token). O Supabase gratuito não oferece backup para baixar; faça isso mensalmente.

## Carrosséis de produto

Skill do Claude Code `/novo-post-produto` (`.claude/skills/`): lê o produto, escreve os textos, gera os slides com o
kit `carrossel/kit/` (Chrome headless), mostra a prévia e, após aprovação, publica pela API de agente
(`AUTOMATION_API_KEY`) e cria a regra de link só para seguidores. Requer a permissão
`instagram_business_content_publish` no app da Meta.

## Licença

MIT (ver `LICENSE`), como o projeto original.
