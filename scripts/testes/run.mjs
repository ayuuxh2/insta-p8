// Regression tests against a locally running build. They use the real Supabase project with fake
// Instagram ids and remove everything they create. Instagram sends fail (fake recipients) — that is
// expected; the tests check what the system decides and records.
//
//   npm.cmd run build
//   (PowerShell)  $env:ADMIN_PASSWORD="teste-local-123456"; npx.cmd next start -p 3400
//   (outro terminal)  $env:TEST_ADMIN_PASSWORD="teste-local-123456"; node scripts/testes/run.mjs
//
// Optional: TEST_BASE_URL (default http://localhost:3400).

import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..")
const require = createRequire(path.join(ROOT, "package.json"))
const { createClient } = require("@supabase/supabase-js")

const env = { ...process.env }
for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) env[m[1]] = m[2].trim()
}
const B = (env.TEST_BASE_URL || "http://localhost:3400").replace(/\/$/, "")
const PASSWORD = env.TEST_ADMIN_PASSWORD
if (!PASSWORD) throw new Error("Defina TEST_ADMIN_PASSWORD (a mesma senha usada para iniciar o servidor local)")

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now()
const FAKE = `9990${String(RUN).slice(-11)}`
const FAKE2 = `9991${String(RUN).slice(-11)}`

let passed = 0
const failures = []
function check(name, condition, detail = "") {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const { data: user } = await db.from("users").select("id, business_account_id").limit(1).single()
const IG = user.business_account_id

const login = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) })
if (!login.ok) throw new Error(`Login local falhou (${login.status}). O servidor está rodando em ${B} com ADMIN_PASSWORD igual a TEST_ADMIN_PASSWORD?`)
const cookie = login.headers.get("set-cookie").split(";")[0]
const api = (p, init = {}) => fetch(`${B}${p}`, { ...init, headers: { cookie, "Content-Type": "application/json", ...(init.headers || {}) } })

async function hook(body) {
  const raw = JSON.stringify(body)
  const sig = "sha256=" + createHmac("sha256", env.INSTAGRAM_APP_SECRET).update(raw).digest("hex")
  return fetch(`${B}/api/instagram/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw })
}
const comment = (id, from, text, media = "m_test") => ({ object: "instagram", entry: [{ id: IG, time: RUN, changes: [{ field: "comments", value: { id, text, from: { id: from, username: `teste_${from.slice(-4)}` }, media: { id: media } } }] }] })
const dm = (from, mid, text) => ({ object: "instagram", entry: [{ id: IG, time: RUN, messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: RUN, message: { mid, text } }] }] })
const tap = (from, mid, payload) => ({ object: "instagram", entry: [{ id: IG, time: RUN, messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: RUN, postback: { mid, title: "x", payload } }] }] })
const events = async (ig) => (await db.from("contact_events").select("event").eq("ig_id", ig).order("id")).data.map((e) => e.event)
const contact = async (ig) => (await db.from("contacts").select("*").eq("ig_id", ig).maybeSingle()).data

const created = { rules: [], files: [] }

try {
  // ---------------------------------------------------------------- segurança
  console.log("Segurança")
  check("painel sem login redireciona", (await fetch(`${B}/dashboard`, { redirect: "manual" })).status === 307)
  check("API sem login → 401", (await fetch(`${B}/api/automations?userId=${user.id}`)).status === 401)
  check("webhook sem assinatura → 401", (await fetch(`${B}/api/instagram/webhook`, { method: "POST", body: "{}" })).status === 401)
  check("API de agente sem chave → 401", (await fetch(`${B}/api/agent/status`)).status === 401)
  check("rotina diária sem segredo → 401", (await fetch(`${B}/api/cron/daily`)).status === 401)

  // ---------------------------------------------------------------- regras de teste
  const { data: rules } = await db.from("automations").insert([
    { user_id: user.id, name: "zz teste comentário", trigger_source: "comment", trigger_type: "keyword", trigger_value: "zzteste", response_type: "pro", response_content: { message: "conteúdo https://exemplo.com/p", reply_mode: "dm_only", check_follow: true, add_tags: ["teste-auto"] }, is_active: true },
    { user_id: user.id, name: "zz teste dm", trigger_source: "dm", trigger_type: "keyword", trigger_value: "zzdm", response_type: "pro", response_content: { message: "resposta dm" }, is_active: true },
  ]).select("id, name")
  created.rules.push(...rules.map((r) => r.id))
  const gated = rules.find((r) => r.name.includes("comentário"))

  // ---------------------------------------------------------------- comentário → cartão → toque → follow gate
  console.log("Comentário e trava de seguidor")
  const t0 = Date.now()
  await hook(comment(`c1_${RUN}`, FAKE, "quero ZZTESTE"))
  check("webhook responde rápido (< 2s)", Date.now() - t0 < 2000)
  await hook(comment(`c1_${RUN}`, FAKE, "quero ZZTESTE"))
  await hook(comment(`c2_${RUN}`, FAKE, "comentário sem a palavra"))
  await sleep(7000)
  let ev = await events(FAKE)
  check("comentário registrado uma vez (duplicado ignorado)", ev.filter((e) => e === "comment").length === 1, ev.join(","))
  check("tag automática aplicada", (await contact(FAKE))?.tags?.includes("teste-auto"))
  await hook(tap(FAKE, `t1_${RUN}`, `WANT_${gated.id}`))
  await sleep(6000)
  ev = await events(FAKE)
  check("toque em Quero receber registrado", ev.includes("optin_tap"), ev.join(","))
  check("sem confirmação de follow, conteúdo NÃO é entregue", !ev.includes("content_sent"), ev.join(","))
  const { data: attempts } = await db.from("unlock_attempts").select("count").like("key", `${FAKE}::%`)
  check("tentativa de verificação contada", (attempts?.[0]?.count || 0) >= 1)

  // ---------------------------------------------------------------- SAIR / VOLTAR
  console.log("SAIR e VOLTAR")
  await hook(dm(FAKE2, `d1_${RUN}`, "Sair"))
  await sleep(3000)
  check("SAIR marca a pessoa fora da lista", (await contact(FAKE2))?.opted_out === true)
  await hook(dm(FAKE2, `d2_${RUN}`, "zzdm"))
  await sleep(3000)
  check("palavra-chave depois do SAIR é ignorada", !(await events(FAKE2)).includes("dm"))
  await hook(dm(FAKE2, `d3_${RUN}`, "voltar"))
  await sleep(3000)
  check("VOLTAR reativa", (await contact(FAKE2))?.opted_out === false)

  // ---------------------------------------------------------------- telas e APIs do painel
  console.log("Painel")
  const list = await (await api(`/api/contacts?userId=${user.id}&tag=teste-auto`)).json()
  check("lista de contatos filtra por tag", list.contacts?.some((c) => c.ig_id === FAKE))
  const csv = await api(`/api/contacts/export?userId=${user.id}&tag=teste-auto`)
  const csvBytes = new Uint8Array(await csv.arrayBuffer())
  check("CSV com BOM e cabeçalho", csvBytes[0] === 0xef && csvBytes[1] === 0xbb && new TextDecoder().decode(csvBytes).includes("usuario;perfil"))
  const metrics = await (await api(`/api/metrics?userId=${user.id}&days=7`)).json()
  check("métricas respondem", typeof metrics.totals?.comments === "number")
  const stats = await (await api(`/api/dashboard/stats?userId=${user.id}`)).json()
  check("tela inicial responde", typeof stats.metrics?.contacts === "number")
  const log = await (await api(`/api/webhook-log?userId=${user.id}`)).json()
  check("registro de eventos tem o comentário", log.events?.some((e) => e.data?.ig === FAKE))
  const backup = await api(`/api/admin/backup?userId=${user.id}`)
  const backupJson = await backup.json()
  check("backup baixa e não inclui token", backupJson.format === "cee-automacao-backup" && !JSON.stringify(backupJson).includes("access_token"))

  // ---------------------------------------------------------------- arquivos e links rastreados
  console.log("Arquivos e links")
  const bad = await api("/api/files/upload-url", { method: "POST", body: JSON.stringify({ userId: user.id, name: "x.html", size: 10 }) })
  check("arquivo .html recusado", bad.status === 400)
  const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n")
  const prep = await (await api("/api/files/upload-url", { method: "POST", body: JSON.stringify({ userId: user.id, name: "teste.pdf", size: pdf.length }) })).json()
  const form = new FormData()
  form.append("cacheControl", "3600")
  form.append("", new Blob([pdf], { type: "application/pdf" }), "teste.pdf")
  await fetch(prep.signedUrl, { method: "PUT", body: form, headers: { "x-upsert": "false" } })
  const { file } = await (await api("/api/files", { method: "POST", body: JSON.stringify({ userId: user.id, path: prep.path, name: "teste.pdf", size: pdf.length }) })).json()
  check("upload de arquivo registrado", !!file?.id)
  if (file?.id) created.files.push(file.id)
  const code = `t${String(RUN).slice(-7)}`
  await db.from("tracked_links").insert({ code, user_id: user.id, ig_id: FAKE, file_id: file.id })
  const bot = await fetch(`${B}/r/${code}`, { redirect: "manual", headers: { "user-agent": "facebookexternalhit/1.1" } })
  const human = await fetch(`${B}/r/${code}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0" } })
  check("link de arquivo redireciona", bot.status === 302 && human.status === 302)
  const { data: linkRow } = await db.from("tracked_links").select("clicks").eq("code", code).single()
  check("robô não conta clique, pessoa conta", linkRow.clicks === 1, `cliques=${linkRow.clicks}`)
  check("código inexistente → 404", (await fetch(`${B}/r/naoexiste0`)).status === 404)

  // ---------------------------------------------------------------- API de agente
  console.log("API de agente")
  const key = env.AUTOMATION_API_KEY
  const agent = (p, body) => fetch(`${B}/api/agent/${p}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const ruleRes = await (await agent("rules", { mediaId: "999", name: "zz teste agente", keywords: ["zzagente"], message: "oi", link: "https://exemplo.com" })).json()
  check("agente cria regra com link", ruleRes.ok === true)
  if (ruleRes.rule?.id) created.rules.push(ruleRes.rule.id)
  check("agente recusa imagem de outra pasta", (await agent("publish", { paths: ["outro/x.jpg"], caption: "x" })).status === 400)

  // ---------------------------------------------------------------- LGPD
  console.log("LGPD")
  await hook(dm(FAKE, `d4_${RUN}`, "Excluir meus dados"))
  await sleep(4000)
  check("EXCLUIR MEUS DADOS apaga contato e histórico", !(await contact(FAKE)) && (await events(FAKE)).length === 0)
  const { count: linksLeft } = await db.from("tracked_links").select("code", { count: "exact", head: true }).eq("ig_id", FAKE)
  check("EXCLUIR MEUS DADOS apaga os links", linksLeft === 0)
  const del = await api(`/api/contacts?userId=${user.id}&igId=${FAKE2}`, { method: "DELETE" })
  check("excluir pela tela de contatos", del.ok && !(await contact(FAKE2)))
} finally {
  for (const ig of [FAKE, FAKE2]) {
    await db.from("contact_events").delete().eq("ig_id", ig)
    await db.from("tracked_links").delete().eq("ig_id", ig)
    await db.from("contacts").delete().eq("ig_id", ig)
    await db.from("unlock_attempts").delete().like("key", `${ig}::%`)
    const { data: conv } = await db.from("conversations").select("id").eq("recipient_id", ig).maybeSingle()
    if (conv) {
      await db.from("messages").delete().eq("conversation_id", conv.id)
      await db.from("conversations").delete().eq("id", conv.id)
    }
    await db.from("webhook_events").delete().eq("data->>ig", ig)
    await db.from("webhook_events").delete().eq("data->>de", ig)
  }
  await db.from("webhook_events").delete().eq("data->>de", "(dados excluídos)")
  for (const id of created.files) await api(`/api/files?userId=${user.id}&id=${id}`, { method: "DELETE" })
  if (created.rules.length) await db.from("automations").delete().in("id", created.rules)
  await db.from("processed_events").delete().like("event_key", `%${RUN}%`)
  console.log("\nDados de teste removidos.")
}

console.log(`\n${passed} ok, ${failures.length} falha(s)`)
if (failures.length) {
  console.log("Falhas:\n- " + failures.join("\n- "))
  process.exit(1)
}
