// Fila de pedidos do Raio-X (API /api/agent/raiox). Usado pela skill /raiox-automatico.
//   node raiox/fila.mjs proximo --conta @cloviseduardo            → pega o pedido mais antigo (ou {"request":null})
//   node raiox/fila.mjs entregar <id> <dados.json> <pasta_saida> --conta @cloviseduardo
//        gera o PDF (raiox/gerar.mjs), envia ao armazenamento e manda o link no Direct do lead
//   node raiox/fila.mjs falhou <id> "motivo" --conta @cloviseduardo
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { agentApi } from "../conteudo/kit/common.mjs"

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return ""
  const [, v] = args.splice(i, 2)
  return v || ""
}
const conta = flag("--conta") || "@cloviseduardo"
const [cmd, id, a, b] = args
const api0 = agentApi()
const api = (route, init = {}) => api0(route, { ...init, headers: { "X-Account": conta, ...(init.headers || {}) } })
const post = (body) => api("raiox", { method: "POST", body: JSON.stringify(body) })

async function enviar(signedUrl, file, type) {
  const res = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": type }, body: readFileSync(file) })
  if (!res.ok) throw new Error(`upload falhou: HTTP ${res.status}`)
}

if (cmd === "proximo") {
  console.log(JSON.stringify(await api("raiox")))
} else if (cmd === "falhou") {
  await post({ action: "fail", id, error: a || "sem motivo" })
  console.log("ok")
} else if (cmd === "entregar") {
  const dados = JSON.parse(readFileSync(a, "utf8"))
  // gerar.mjs sai com erro se a validação reprovar o texto
  const out = execFileSync("node", [path.join(AQUI, "gerar.mjs"), a, b], { encoding: "utf8" })
  const { pdf, capa } = JSON.parse(out.trim().split("\n").pop())
  const up = await post({ action: "upload-url", id, kind: "pdf" })
  await enviar(up.signedUrl, pdf, "application/pdf")
  let coverPath
  try {
    const upc = await post({ action: "upload-url", id, kind: "cover" })
    await enviar(upc.signedUrl, capa, "image/png")
    coverPath = upc.path
  } catch {}
  const naoVerificado = [...(dados.nao_verificado || []), ...dados.checks.filter((c) => c.status === "nv").map((c) => c.area)]
  const r = await post({
    action: "deliver",
    id,
    pdf_path: up.path,
    cover_path: coverPath,
    business: dados.negocio,
    summary: dados.resumo,
    not_verified: [...new Set(naoVerificado)],
  })
  console.log(JSON.stringify(r))
} else {
  console.error("Uso: proximo | entregar <id> <dados.json> <saida> | falhou <id> <motivo>   (--conta @nome)")
  process.exit(1)
}
