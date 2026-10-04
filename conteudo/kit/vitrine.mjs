// Sends the week's products to the vitrine (link da bio, page /links):
//   node conteudo/kit/vitrine.mjs <semana>            add/update
//   node conteudo/kit/vitrine.mjs <semana> --check    validate only
//   node conteudo/kit/vitrine.mjs --listar            show what is on the page
//
// <semana>/vitrine.json:
// [ { "title": "Dinossauro T-Rex que solta fumaça", "category": "Brinquedos", "emoji": "🦖",
//     "link": "https://meli.la/…", "image": "fotos/dino-1.jpg", "affiliate": true } ]
// Products are matched by link: running again updates them and keeps their numbers.
// Never use Amazon product images here (Associates license) — our own photos or the seller's (Mercado Livre/Shopee).

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { agentApi, readJson, sharp } from "./common.mjs"

const api = agentApi()

if (process.argv.includes("--listar")) {
  const { items } = await api("vitrine")
  for (const i of items.sort((a, b) => a.number - b.number)) console.log(`nº ${String(i.number).padStart(3)}  ${i.hidden ? "(oculto) " : ""}${i.category.padEnd(12)} ${i.title}`)
  process.exit(0)
}

const week = path.resolve(process.argv[2] || ".")
const checkOnly = process.argv.includes("--check")
const list = readJson(path.join(week, "vitrine.json"))
const problems = []
for (const p of list) {
  if (!p.title || !p.category || !/^https?:\/\//.test(p.link || "")) problems.push(`produto incompleto: ${p.title || p.link}`)
  if (p.image && !existsSync(path.join(week, p.image))) problems.push(`foto não encontrada: ${p.image}`)
}
if (problems.length) {
  console.error("Corrija:\n- " + problems.join("\n- "))
  process.exit(1)
}
console.log(`${list.length} produtos prontos para a vitrine`)
if (checkOnly) process.exit(0)

async function uploadImage(file) {
  // Square 800 px JPEG: light on mobile, same look for every card.
  const buffer = await sharp(file).resize(800, 800, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer()
  const { path: storagePath, signedUrl } = await api("upload-url", { method: "POST", body: JSON.stringify({ name: "vitrine.jpg" }) })
  const form = new FormData()
  form.append("cacheControl", "86400")
  form.append("", new Blob([buffer], { type: "image/jpeg" }), "vitrine.jpg")
  const put = await fetch(signedUrl, { method: "PUT", body: form, headers: { "x-upsert": "false" } })
  if (!put.ok) throw new Error(`Falha ao enviar a foto: HTTP ${put.status}`)
  return storagePath
}

const items = []
for (const p of list) {
  items.push({
    title: p.title,
    category: p.category,
    emoji: p.emoji,
    link: p.link,
    affiliate: p.affiliate === true,
    imagePath: p.image ? await uploadImage(path.join(week, p.image)) : undefined,
  })
}
const { items: saved } = await api("vitrine", { method: "POST", body: JSON.stringify({ items }) })
for (const s of saved) console.log(`nº ${String(s.number).padStart(3)}  ${s.category.padEnd(12)} ${s.title}`)
console.log("Pronto. Página: /links")
