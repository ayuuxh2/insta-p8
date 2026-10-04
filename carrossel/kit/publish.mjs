// Publishes a built carousel and creates its comment rule through the system's agent API.
//   node carrossel/kit/publish.mjs <dir>            publish for real
//   node carrossel/kit/publish.mjs <dir> --check    only checks connection, permission and files
//
// Needs in .env.local: AUTOMATION_API_KEY (same value as on Vercel). Optional: AGENT_BASE_URL.
// <dir>/post.json:
// {
//   "caption": "legenda completa (até 2.200 caracteres)",
//   "keywords": ["fio"],                       // palavra(s) que disparam a regra; a 1ª deve ser a do slide final
//   "dmMessage": "mensagem da DM (o link é anexado no final)",
//   "messageVariants": ["outra versão"],       // opcional
//   "link": "https://amzn.to/...",
//   "ruleName": "Afiador de facas — FIO",
//   "tags": ["afiador", "churrasco"],          // opcional
//   "checkFollow": true,                       // só para seguidores (padrão true)
//   "anyComment": false,                       // true: responde a QUALQUER comentário do post (keywords viram opcionais)
//   "publicReplies": ["Te mandei no direct! 📩"], // opcional
//   "optinTitle": "", "optinSubtitle": "", "optinButton": ""   // opcional (cartão "Quero receber")
// }

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..")
const dir = path.resolve(process.argv[2] || ".")
const checkOnly = process.argv.includes("--check")

function readEnv() {
  const env = {}
  const file = path.join(ROOT, ".env.local")
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  }
  return { ...env, ...process.env }
}

const env = readEnv()
const BASE = (env.AGENT_BASE_URL || "https://cee-automacao.vercel.app").replace(/\/$/, "")
const KEY = env.AUTOMATION_API_KEY
if (!KEY) throw new Error("AUTOMATION_API_KEY não encontrada no .env.local")

async function api(route, init = {}) {
  const res = await fetch(`${BASE}/api/agent/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${route}: ${json.error || `HTTP ${res.status}`}`)
  return json
}

// ---------- Validate the post folder ----------
const post = JSON.parse(readFileSync(path.join(dir, "post.json"), "utf8"))
const carousel = JSON.parse(readFileSync(path.join(dir, "carrossel.json"), "utf8"))
const slides = readdirSync(path.join(dir, "out"))
  .filter((f) => /^slide-\d+\.jpg$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))

const problems = []
const keyword = String(carousel.keyword || "").toLowerCase()
if (slides.length !== carousel.slides.length) problems.push(`out/ tem ${slides.length} imagens, mas carrossel.json tem ${carousel.slides.length} slides (rode o build de novo)`)
if (!post.caption || post.caption.length > 2200) problems.push("legenda vazia ou acima de 2.200 caracteres")
if (!Array.isArray(post.keywords) || !post.keywords.length) { if (!post.anyComment) problems.push("keywords vazio") }
else if (post.keywords[0].toLowerCase() !== keyword) problems.push(`a 1ª keyword ("${post.keywords[0]}") não é a do slide final ("${carousel.keyword}")`)
if (keyword && !post.caption?.toLowerCase().includes(keyword)) problems.push(`a legenda não menciona a palavra "${carousel.keyword}"`)
if (!post.dmMessage) problems.push("dmMessage vazio")
if (!post.link || !/^https?:\/\//.test(post.link)) problems.push("link do produto inválido")
if (problems.length) {
  console.error("Corrija antes de publicar:\n- " + problems.join("\n- "))
  process.exit(1)
}

// ---------- Status ----------
const status = await api("status")
console.log(`Conta: @${status.username} · conexão: ${status.connection}`)
if (status.publishing?.error) console.log(`Publicação: ERRO — ${status.publishing.error}`)
else console.log(`Publicação: ${status.publishing.used}/${status.publishing.limit} posts nas últimas 24h`)
if (!status.ok || status.publishing?.error) {
  console.error("Não é possível publicar agora (veja acima). Se for permissão, adicione instagram_business_content_publish no app da Meta e reconecte a conta.")
  process.exit(1)
}
console.log(`${slides.length} slides prontos · palavra: ${carousel.keyword} · link: ${post.link}`)
if (checkOnly) {
  console.log("Verificação OK (nada foi publicado).")
  process.exit(0)
}

// ---------- Upload slides ----------
const paths = []
for (const file of slides) {
  const { path: storagePath, signedUrl } = await api("upload-url", { method: "POST", body: JSON.stringify({ name: file }) })
  const form = new FormData()
  form.append("cacheControl", "3600")
  form.append("", new Blob([readFileSync(path.join(dir, "out", file))], { type: "image/jpeg" }), file)
  const put = await fetch(signedUrl, { method: "PUT", body: form, headers: { "x-upsert": "false" } })
  if (!put.ok) throw new Error(`Falha ao enviar ${file}: HTTP ${put.status}`)
  paths.push(storagePath)
  console.log(`enviado ${file}`)
}

// ---------- Publish + rule ----------
const published = await api("publish", { method: "POST", body: JSON.stringify({ paths, caption: post.caption }) })
console.log(`Publicado: ${published.permalink}`)

const { rule } = await api("rules", {
  method: "POST",
  body: JSON.stringify({
    mediaId: published.mediaId,
    name: post.ruleName,
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
    anyComment: post.anyComment === true,
  }),
})
console.log(`Regra criada: "${rule.name}" (palavras: ${rule.trigger_value})`)

writeFileSync(path.join(dir, "result.json"), JSON.stringify({ publishedAt: new Date().toISOString(), ...published, rule }, null, 2))
console.log("Resultado salvo em result.json")
