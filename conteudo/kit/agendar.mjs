// Uploads a week of content and puts it in the publishing queue (published by /api/cron/publish):
//   node conteudo/kit/agendar.mjs <semana>            schedule for real
//   node conteudo/kit/agendar.mjs <semana> --check    validate only (nothing is uploaded)
//
// <semana>/agenda.json — times are Brasília time (UTC−3):
// {
//   "batch": "2026-10-06",
//   "posts": [
//     { "when": "2026-10-06 12:00", "kind": "reel",     "dir": "termometro" },
//     { "when": "2026-10-06 08:30", "kind": "story",    "dir": "termometro", "media": "out/story-1.jpg", "rule": false },
//     { "when": "2026-10-06 20:00", "kind": "story",    "dir": "termometro", "media": "out/reel.mp4" },
//     { "when": "2026-10-07 18:00", "kind": "carousel", "dir": "termometro-carrossel" }
//   ]
// }
// Defaults: reel → out/reel.mp4 + cover out/capa.jpg · carousel → out/slide-N.jpg · story → "media" is required.
// Caption and DM rule come from <dir>/post.json (same format as carrossel/kit/publish.mjs; "post" overrides the file).
// Feed posts get a comment rule; Stories get a reply rule with the same keyword ("rule": false disables it).
// Already scheduled entries (agenda.result.json) are skipped, so the script can be run again after a fix.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { agentApi, mediaDuration, readJson } from "./common.mjs"

const week = path.resolve(process.argv[2] || ".")
const checkOnly = process.argv.includes("--check")
const agenda = readJson(path.join(week, "agenda.json"))
const resultFile = path.join(week, "agenda.result.json")
const done = existsSync(resultFile) ? readJson(resultFile) : {}
const batch = agenda.batch || path.basename(week)

const KIND_NAMES = { reel: "Reel", carousel: "Carrossel", image: "Foto", story: "Story" }
const toDate = (when) => new Date(`${String(when).trim().replace(" ", "T")}${/[+-]\d\d:\d\d$|Z$/.test(when) ? "" : "-03:00"}`)
const fmt = (d) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

function ruleBody(post, kind) {
  return {
    name: `${post.ruleName || post.keywords?.[0] || "Post"} (${KIND_NAMES[kind]})`,
    keywords: post.keywords,
    message: post.dmMessage,
    messageVariants: post.messageVariants,
    link: post.link,
    tags: post.tags,
    checkFollow: post.checkFollow !== false,
    publicReplies: post.publicReplies,
    optinTitle: post.optinTitle,
    optinSubtitle: post.optinSubtitle,
    optinButton: post.optinButton,
    replyMode: post.replyMode,
    anyComment: post.anyComment === true && kind !== "story",
  }
}

// ---------- Validate everything first ----------
const items = []
const problems = []
for (const [i, entry] of (agenda.posts || []).entries()) {
  const where = `#${i + 1} (${entry.kind} ${entry.dir} ${entry.when})`
  const kind = entry.kind
  if (!KIND_NAMES[kind]) { problems.push(`${where}: kind inválido`); continue }
  const when = toDate(entry.when)
  if (Number.isNaN(when.getTime())) { problems.push(`${where}: horário inválido`); continue }
  const dir = path.join(week, entry.dir || "")
  const key = `${entry.when}|${kind}|${entry.dir}|${entry.media || ""}`
  if (done[key]) continue
  if (when.getTime() < Date.now() + 5 * 60_000) problems.push(`${where}: horário já passou (ou falta menos de 5 min)`)

  let media = entry.media ? [entry.media] : []
  let cover = entry.cover
  if (!media.length && kind === "reel") { media = ["out/reel.mp4"]; cover ??= "out/capa.jpg" }
  if (!media.length && kind === "carousel" && existsSync(path.join(dir, "out"))) {
    media = readdirSync(path.join(dir, "out")).filter((f) => /^slide-\d+\.jpg$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map((f) => `out/${f}`)
  }
  if (!media.length) { problems.push(`${where}: sem mídia (informe "media")`); continue }
  const files = media.map((m) => path.join(dir, m))
  const coverFile = cover && existsSync(path.join(dir, cover)) ? path.join(dir, cover) : null
  for (const f of files) {
    if (!existsSync(f)) { problems.push(`${where}: arquivo não encontrado ${path.relative(week, f)}`); continue }
    if (!/\.(jpe?g|mp4)$/i.test(f)) problems.push(`${where}: ${path.basename(f)} precisa ser .jpg ou .mp4`)
    if (statSync(f).size > 50 * 1024 * 1024) problems.push(`${where}: ${path.basename(f)} passa de 50 MB`)
    if (/\.mp4$/i.test(f)) {
      const secs = mediaDuration(f)
      if (secs < 3 || secs > (kind === "story" ? 60 : 90)) problems.push(`${where}: vídeo com ${secs.toFixed(0)}s (Story até 60s, Reel até 90s)`)
    }
  }
  if (kind === "reel" && !/\.mp4$/i.test(media[0])) problems.push(`${where}: Reel precisa de .mp4`)
  if (kind === "carousel" && (media.length < 2 || media.length > 10)) problems.push(`${where}: carrossel com ${media.length} arquivos (2 a 10)`)

  const postFile = path.join(dir, entry.post || "post.json")
  const post = existsSync(postFile) ? JSON.parse(readFileSync(postFile, "utf8")) : null
  const wantsRule = entry.rule !== false
  if (kind !== "story" && !post?.caption) problems.push(`${where}: legenda vazia (${path.relative(week, postFile)})`)
  if (post?.caption?.length > 2200) problems.push(`${where}: legenda acima de 2.200 caracteres`)
  let rule = null
  if (wantsRule) {
    if (!post) problems.push(`${where}: ${path.relative(week, postFile)} não encontrado (ou use "rule": false)`)
    else {
      if (!post.dmMessage) problems.push(`${where}: dmMessage vazio`)
      if (!post.keywords?.length && !(post.anyComment && kind !== "story")) problems.push(`${where}: keywords vazio`)
      if (!post.link || !/^https?:\/\//.test(post.link)) problems.push(`${where}: link inválido`)
      const kw = post.keywords?.[0]?.toLowerCase()
      if (kw && kind !== "story" && !post.caption?.toLowerCase().includes(kw)) problems.push(`${where}: a legenda não menciona "${post.keywords[0]}"`)
      rule = ruleBody(post, kind)
    }
  }
  const label = entry.label || `${KIND_NAMES[kind]} · ${entry.dir}${kind === "story" ? ` · ${path.basename(media[0])}` : ""}`
  items.push({ key, kind, when, label, files, coverFile: kind === "reel" ? coverFile : null, caption: kind === "story" ? "" : post?.caption || "", rule })
}

items.sort((a, b) => a.when - b.when)
console.log(`Lote "${batch}": ${items.length} publicações novas${Object.keys(done).length ? ` (${Object.keys(done).length} já agendadas antes)` : ""}`)
for (const it of items) console.log(`  ${fmt(it.when)}  ${it.label}${it.rule ? `  → regra "${it.rule.keywords?.[0] || "todos"}"` : ""}`)
const perDay = {}
for (const it of items) { const d = fmt(it.when).slice(0, 10); perDay[d] = (perDay[d] || 0) + 1 }
const busiest = Math.max(0, ...Object.values(perDay))
if (busiest > 25) problems.push(`um dia tem ${busiest} publicações; o Instagram aceita até 100 por 24h via API, mas mais de 25 por dia parece spam`)

if (problems.length) {
  console.error("\nCorrija antes de agendar:\n- " + problems.join("\n- "))
  process.exit(1)
}

const api = agentApi()
const status = await api("status")
console.log(`\nConta: @${status.username} · conexão: ${status.connection}`)
if (!status.ok || status.publishing?.error) {
  console.error(`Não é possível agendar agora: ${status.publishing?.error || status.connection}`)
  process.exit(1)
}
if (checkOnly) {
  console.log("Verificação OK (nada foi enviado).")
  process.exit(0)
}

// ---------- Upload and schedule ----------
async function upload(file) {
  const name = path.basename(file)
  const { path: storagePath, signedUrl } = await api("upload-url", { method: "POST", body: JSON.stringify({ name }) })
  const form = new FormData()
  form.append("cacheControl", "3600")
  form.append("", new Blob([readFileSync(file)], { type: /\.mp4$/i.test(name) ? "video/mp4" : "image/jpeg" }), name)
  const put = await fetch(signedUrl, { method: "PUT", body: form, headers: { "x-upsert": "false" } })
  if (!put.ok) throw new Error(`Falha ao enviar ${name}: HTTP ${put.status}`)
  return storagePath
}

for (const it of items) {
  const paths = []
  for (const f of it.files) paths.push(await upload(f))
  const coverPath = it.coverFile ? await upload(it.coverFile) : undefined
  const { item } = await api("schedule", {
    method: "POST",
    body: JSON.stringify({ kind: it.kind, scheduledAt: it.when.toISOString(), paths, coverPath, caption: it.caption, label: it.label, batch, rule: it.rule }),
  })
  done[it.key] = item.id
  writeFileSync(resultFile, JSON.stringify(done, null, 2))
  console.log(`agendado  ${fmt(it.when)}  ${it.label}`)
}
console.log(`\nPronto: ${items.length} publicações na fila. Veja com: node conteudo/kit/agenda.mjs`)
