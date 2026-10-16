// Lists products that already have a rule (and so a post), to avoid suggesting them again.
//   node afiliados/postados.mjs
// Prints one line per rule: name, platform and product id (Amazon ASIN, Mercado Livre MLB, Shopee item) found in its link.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const require = createRequire(path.join(ROOT, "package.json"))
const { createClient } = require("@supabase/supabase-js")

const env = {}
for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: rules, error } = await db.from("automations").select("name, is_active, response_content, created_at").order("created_at")
if (error) throw new Error(error.message)

function productIds(text) {
  const ids = []
  for (const m of text.matchAll(/amazon\.com\.br\/(?:[^\s"/]+\/)?dp\/([A-Z0-9]{10})/gi)) ids.push(`amazon:${m[1].toUpperCase()}`)
  for (const m of text.matchAll(/amzn\.to\/([A-Za-z0-9]+)/g)) ids.push(`amazon-curto:${m[1]}`)
  for (const m of text.matchAll(/MLB-?(\d{6,})/gi)) ids.push(`mercadolivre:MLB${m[1]}`)
  for (const m of text.matchAll(/(?:shopee\.com\.br\/[^\s"]*?i\.(\d+)\.(\d+)|s\.shopee\.com\.br\/([A-Za-z0-9]+))/g)) ids.push(m[3] ? `shopee-curto:${m[3]}` : `shopee:${m[1]}.${m[2]}`)
  return [...new Set(ids)]
}

let count = 0
for (const rule of rules || []) {
  const ids = productIds(JSON.stringify(rule.response_content || {}))
  if (!ids.length) continue
  count++
  console.log(`${rule.is_active ? "ativa  " : "pausada"} | ${rule.name} | ${ids.join(", ")}`)
}
if (!count) console.log("Nenhum produto com link em regras ainda.")
