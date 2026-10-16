// Reads the Shopee affiliate product feed (CSV from Painel → Criativo → Feed de produto) and lists the best
// candidates for a niche. The feed is large (hundreds of MB) and has no commission column.
//   node afiliados/shopee-feed.mjs <arquivo.csv> --categorias           counts per category
//   node afiliados/shopee-feed.mjs <arquivo.csv> "<regex de categoria>" [--min 60 --max 300 --nota 4.7 --top 40]
// Output: tab-separated rows (score, price, discount, ratings, title, category, short link, image).
import { createReadStream } from "node:fs"

const [file, filterArg, ...rest] = process.argv.slice(2)
if (!file) throw new Error("Informe o arquivo CSV do feed")
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? Number(rest[i + 1]) : def
}
const listCategories = filterArg === "--categorias"
const categoryRe = listCategories ? null : new RegExp(filterArg || "Tools|Home Improvement", "i")
const MIN = opt("min", 60), MAX = opt("max", 300), RATING = opt("nota", 4.7), TOP = opt("top", 40)

// Streaming CSV parser (handles quotes, escaped quotes and newlines inside fields).
async function* rows(path) {
  let field = "", row = [], inQuotes = false, pendingQuote = false
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (pendingQuote) {
        pendingQuote = false
        if (ch === '"') { field += '"'; continue }
        inQuotes = false
      }
      if (inQuotes) {
        if (ch === '"') pendingQuote = true
        else field += ch
        continue
      }
      if (ch === '"') inQuotes = true
      else if (ch === ",") { row.push(field); field = "" }
      else if (ch === "\n") { row.push(field.replace(/\r$/, "")); yield row; row = []; field = "" }
      else field += ch
    }
  }
  if (field || row.length) { row.push(field); yield row }
}

let header = null
const counts = new Map()
const picks = []
for await (const r of rows(file)) {
  if (!header) { header = r.map((h) => h.replace(/^﻿/, "").trim()); continue }
  const get = (name) => r[header.indexOf(name)] ?? ""
  const cats = [get("global_category1"), get("global_category2"), get("global_category3")]
  if (listCategories) {
    const key = `${cats[0]} > ${cats[1]}`
    counts.set(key, (counts.get(key) || 0) + 1)
    continue
  }
  if (!categoryRe.test(cats.join(" > "))) continue
  const price = Number(get("sale_price") || get("price"))
  const itemRating = Number(get("item_rating"))
  const shopRating = Number(get("shop_rating"))
  const likes = Number(get("like")) || 0
  if (!(price >= MIN && price <= MAX) || itemRating < RATING || shopRating < 4.5) continue
  const discount = Number(get("discount_percentage")) || 0
  // Likes are the only popularity signal in the feed.
  const score = Math.log10(likes + 1) * 2 + itemRating + Math.min(discount, 60) / 30 + Math.log10(price) * 1.5
  picks.push({ score, price, discount, itemRating, likes, title: get("title"), cats: cats.join(" > "), link: get("product_short link") || get("product_link"), image: get("image_link"), itemid: get("itemid") })
}

if (listCategories) {
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`${v}\t${k}`)
} else {
  // Keep one entry per similar title (the feed repeats near-identical listings).
  const seen = new Set()
  const unique = picks.sort((a, b) => b.score - a.score).filter((p) => {
    const key = p.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").slice(0, 5).join(" ")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`${picks.length} produtos passaram nos filtros; ${unique.length} únicos. Top ${TOP}:`)
  for (const p of unique.slice(0, TOP)) {
    console.log([p.score.toFixed(2), `R$ ${p.price.toFixed(2)}`, `-${p.discount}%`, `★${p.itemRating}`, `♥${p.likes}`, p.title.slice(0, 80), p.cats, p.link, p.image].join("\t"))
  }
}
