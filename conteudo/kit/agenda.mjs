// Shows the publishing queue, or cancels items that were not published yet:
//   node conteudo/kit/agenda.mjs                      upcoming + last 2 days
//   node conteudo/kit/agenda.mjs --cancelar <id>      cancel one item
//   node conteudo/kit/agenda.mjs --cancelar-lote <batch>

import { agentApi } from "./common.mjs"

const api = agentApi()
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

const id = flag("--cancelar")
const batch = flag("--cancelar-lote")
if (id || batch) {
  const { canceled } = await api(`schedule?${id ? `id=${encodeURIComponent(id)}` : `batch=${encodeURIComponent(batch)}`}`, { method: "DELETE" })
  console.log(`${canceled} publicação(ões) cancelada(s).`)
  process.exit(0)
}

const STATUS = { pending: "na fila", processing: "enviando", published: "publicado", failed: "FALHOU", canceled: "cancelado" }
const { items } = await api("schedule")
if (!items.length) console.log("Nada agendado.")
for (const it of items) {
  const when = new Date(it.scheduled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  const extra = it.status === "published" ? it.permalink || "" : it.error ? `(${it.error})` : ""
  console.log(`${when}  ${STATUS[it.status].padEnd(10)} ${it.label}  ${extra}  [${it.id}]`)
}
