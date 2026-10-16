// Gera o Raio-X de Anúncios (PDF + capa PNG) na marca do Clóvis Eduardo a partir de um JSON.
// Uso: node raiox/gerar.mjs dados.json [pasta_de_saida]
//
// Campos do JSON:
//   negocio, handle, segmento, cidade, data (DD/MM/AAAA), resumo
//   checks:     [{area, status: ok|atencao|critico|nv, evidencia}]   (6 pontos)
//   vazamentos: [{titulo, visto, custo}]                             (3)
//   acoes:      [{titulo, detalhe}]                                  (3)
//   nao_verificado: [texto]  (opcional; o que não foi possível ler — aparece no rodapé do PDF)
//
// Sem revisão humana, as regras abaixo (validar) barram o que a marca proíbe: emoji, hashtag, promessa de venda,
// prazo de entrega, ponto "Não verificado" sem explicar o que faltou, texto vazio ou gigante.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const puppeteer = require("puppeteer-core")
const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(AQUI, "assets")

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean)

const STATUS = {
  ok: { label: "Ok", color: "#12352B", bg: "#E4EDE6" },
  atencao: { label: "Atenção", color: "#8A5A2B", bg: "#F3E7D2" },
  critico: { label: "Crítico", color: "#B9472F", bg: "#F6E1DA" },
  nv: { label: "Não verificado", color: "#5E584E", bg: "#ECE6DA" },
}
const AREAS = ["Perfil e bio", "Constância", "Conteúdo", "Site e oferta", "Caminho até a conversa", "Anúncios ativos"]

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const slug = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "negocio"
const font = (file) => readFileSync(path.join(ASSETS, file)).toString("base64")
const svg = (file) => readFileSync(path.join(ASSETS, file), "utf8").replace(/<metadata>[\s\S]*?<\/metadata>/g, "")

// ---------- validação (substitui a revisão humana) ----------
export function validar(d) {
  const erros = []
  const texto = (v, nome, min, max) => {
    const s = String(v ?? "").trim()
    if (s.length < min) erros.push(`${nome}: vazio ou curto demais`)
    if (s.length > max) erros.push(`${nome}: passa de ${max} caracteres`)
    return s
  }
  texto(d.negocio, "negocio", 2, 70)
  texto(d.resumo, "resumo", 30, 230)
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(d.data || ""))) erros.push("data deve ser DD/MM/AAAA")
  if (!Array.isArray(d.checks) || d.checks.length !== 6) erros.push("checks deve ter exatamente 6 pontos")
  else {
    d.checks.forEach((c, i) => {
      if (c.area !== AREAS[i]) erros.push(`checks[${i}].area deve ser "${AREAS[i]}"`)
      if (!STATUS[c.status]) erros.push(`checks[${i}].status inválido (${c.status})`)
      const ev = texto(c.evidencia, `checks[${i}].evidencia`, 20, 230)
      if (c.status === "nv" && !/(não consegui|nao consegui|não foi possível|sem acesso|privad|bloquead|não aparece|indispon)/i.test(ev)) {
        erros.push(`checks[${i}] "Não verificado" precisa dizer o que não foi possível ler e por quê`)
      }
    })
    if (d.checks.every((c) => c.status === "nv")) erros.push("todos os pontos estão 'Não verificado': nada foi lido, não há Raio-X a entregar")
    if (d.checks.filter((c) => c.status === "nv").length > 3) erros.push("mais de 3 pontos não verificados: leitura insuficiente")
  }
  if (!Array.isArray(d.vazamentos) || d.vazamentos.length !== 3) erros.push("vazamentos deve ter exatamente 3")
  else d.vazamentos.forEach((v, i) => ["titulo", "visto", "custo"].forEach((k) => texto(v[k], `vazamentos[${i}].${k}`, 12, k === "titulo" ? 80 : 260)))
  if (!Array.isArray(d.acoes) || d.acoes.length !== 3) erros.push("acoes deve ter exatamente 3")
  else d.acoes.forEach((a, i) => (texto(a.titulo, `acoes[${i}].titulo`, 12, 90), texto(a.detalhe, `acoes[${i}].detalhe`, 12, 220)))

  const tudo = JSON.stringify(d)
  if (/\p{Extended_Pictographic}/u.test(tudo)) erros.push("emoji não é permitido em peças da marca")
  if (/#\w{3,}/.test(tudo.replace(/#[0-9a-f]{6}\b/gi, ""))) erros.push("hashtag não é permitida")
  if (/(garanto|garantimos|vai vender|vai dobrar|aumentar suas vendas em|resultado garantido|em \d+ ?(h|horas|dias) ?(você|vc) (recebe|vende))/i.test(tudo)) {
    erros.push("promessa de venda/resultado ou de prazo não é permitida")
  }
  if (/(vagas? limitadas?|últimas vagas|ultimas vagas)/i.test(tudo)) erros.push("não use 'vagas limitadas'")
  return erros
}

// ---------- visual ----------
const CSS = `
@font-face { font-family: 'Fraunces'; src: url(data:font/ttf;base64,__FR__) format('truetype'); font-weight: 100 900; font-style: normal; }
@font-face { font-family: 'Fraunces'; src: url(data:font/ttf;base64,__FRI__) format('truetype'); font-weight: 100 900; font-style: italic; }
@font-face { font-family: 'Manrope'; src: url(data:font/ttf;base64,__MA__) format('truetype'); font-weight: 200 800; }
:root { --verde:#12352B; --verde-escuro:#0E2A22; --creme:#F5EFE4; --terracota:#B9472F; --ouro:#C9A45C; --tinta:#1E1C19; --marrom:#8A5A2B; --muted:#5E584E; --line:#DCD2BF; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--creme); }
body { width: 1080px; color: var(--tinta); font-family: 'Manrope', sans-serif; font-size: 27px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.page { padding: 64px 72px 56px; }
.logo svg { height: 76px; width: auto; display: block; }
.label { font-weight: 700; font-size: 19px; letter-spacing: .18em; text-transform: uppercase; color: var(--marrom); }
.label span { color: var(--muted); letter-spacing: .08em; margin-left: 14px; font-weight: 500; }
h1 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 76px; line-height: 1.04; letter-spacing: -.01em; color: var(--verde); margin-top: 16px; text-wrap: balance; }
.meta { margin-top: 16px; font-size: 25px; color: var(--muted); }
.meta b { color: var(--tinta); font-weight: 700; }
.head { margin-top: 84px; }
.resumo { margin-top: 48px; padding: 34px 40px 38px; background: #fff; border: 1px solid var(--line); border-left: 6px solid var(--terracota); border-radius: 24px; }
.resumo p { font-family: 'Fraunces', serif; font-weight: 400; font-size: 38px; line-height: 1.25; margin-top: 12px; color: var(--verde); text-wrap: pretty; }
h2 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 44px; line-height: 1.1; color: var(--verde); margin: 72px 0 24px; }
h2 small { font-family: 'Manrope'; font-weight: 500; font-size: 23px; color: var(--muted); margin-left: 14px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 24px; }
.checks { padding: 8px 36px; }
.check { display: grid; grid-template-columns: 240px 1fr; gap: 24px; padding: 26px 0; border-bottom: 1px solid var(--line); align-items: start; }
.check:last-child { border-bottom: 0; }
.pill { display: inline-block; font-weight: 700; font-size: 20px; padding: 6px 18px; border-radius: 999px; white-space: nowrap; margin-top: 3px; }
.check h3 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 30px; line-height: 1.2; color: var(--verde); }
.check p { margin-top: 6px; font-size: 25px; color: var(--muted); text-wrap: pretty; }
.leak { display: grid; grid-template-columns: 90px 1fr; gap: 20px; padding: 34px 40px 36px; margin-bottom: 20px; }
.num { font-family: 'Fraunces', serif; font-weight: 500; font-style: italic; font-size: 68px; line-height: 1; color: var(--terracota); }
.leak h3 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 34px; line-height: 1.2; color: var(--verde); }
.leak dt { font-weight: 700; font-size: 17px; letter-spacing: .16em; text-transform: uppercase; color: var(--marrom); margin-top: 18px; }
.leak dd { margin-top: 4px; font-size: 25px; color: var(--tinta); text-wrap: pretty; }
.acoes { padding: 12px 40px; }
.acao { display: grid; grid-template-columns: 64px 1fr; gap: 24px; padding: 28px 0; border-bottom: 1px solid var(--line); }
.acao:last-child { border-bottom: 0; }
.acao .n { width: 54px; height: 54px; border-radius: 50%; border: 2px solid var(--terracota); color: var(--terracota); font-family: 'Fraunces', serif; font-size: 28px; display: flex; align-items: center; justify-content: center; }
.acao h3 { font-family: 'Fraunces', serif; font-weight: 500; font-size: 31px; line-height: 1.2; color: var(--verde); }
.acao p { margin-top: 6px; font-size: 25px; color: var(--muted); text-wrap: pretty; }
.cta { margin-top: 72px; padding: 52px 48px; background: var(--verde-escuro); color: var(--creme); border-radius: 28px; }
.cta .label { color: var(--ouro); }
.cta h2 { color: var(--creme); margin: 12px 0 0; font-size: 46px; }
.cta h2 em { color: #E3876A; font-style: italic; }
.offer { display: flex; align-items: baseline; gap: 20px; margin-top: 26px; flex-wrap: wrap; }
.offer .price { font-family: 'Fraunces', serif; font-weight: 500; font-size: 88px; line-height: 1; color: var(--creme); }
.offer .what { font-size: 27px; color: #C9C1B2; }
.cta ul { list-style: none; margin-top: 22px; }
.cta li { font-size: 25px; color: #E4DCCB; padding-left: 30px; position: relative; margin-top: 10px; }
.cta li::before { content: ''; position: absolute; left: 0; top: 17px; width: 14px; height: 2px; background: var(--ouro); }
.btn { display: inline-block; margin-top: 34px; background: var(--terracota); color: #fff; font-weight: 700; font-size: 28px; padding: 22px 40px; border-radius: 999px; }
.site { margin-top: 18px; font-size: 23px; color: #C9C1B2; }
.foot { margin-top: 40px; font-size: 20px; line-height: 1.5; color: var(--muted); text-wrap: pretty; }
.foot b { color: var(--tinta); }
/* capa */
body.capa { background: var(--verde-escuro); color: var(--creme); }
.capa .page { height: 1350px; padding: 64px 72px 0; position: relative; }
.capa .logo svg { height: 70px; }
.capa .label { color: var(--ouro); } .capa .label span { color: #C9C1B2; }
.capa h1 { color: var(--creme); font-size: 72px; }
.capa .meta { color: #C9C1B2; } .capa .meta b { color: var(--creme); }
.capa .head { margin-top: 64px; }
.capa .resumo { background: var(--verde); border-color: #2D5547; border-left-color: #E3876A; margin-top: 40px; }
.capa .resumo p { color: var(--creme); font-size: 35px; }
.capa .resumo .label { color: var(--ouro); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 26px; }
.chip { background: var(--verde); border: 1px solid #2D5547; border-radius: 18px; padding: 18px 22px; }
.chip b { font-family: 'Fraunces', serif; font-weight: 500; font-size: 26px; display: block; line-height: 1.2; color: var(--creme); }
.chip span { font-size: 21px; font-weight: 700; display: block; margin-top: 2px; }
.strip { position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 72px; background: var(--terracota); color: #fff; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 26px; }
.strip span { font-weight: 500; font-size: 23px; }
`

const fontesCss = () => CSS.replace("__FR__", font("Fraunces.ttf")).replace("__FRI__", font("Fraunces-Italic.ttf")).replace("__MA__", font("Manrope.ttf"))
const metaLinha = (d) =>
  [d.handle ? `<b>${esc(d.handle)}</b>` : "", esc(d.segmento || ""), esc(d.cidade || "")].filter(Boolean).join(" · ")

function paginaHtml(d) {
  const checks = d.checks
    .map((c) => {
      const s = STATUS[c.status]
      return `<div class="check"><div><span class="pill" style="color:${s.color};background:${s.bg}">${s.label}</span></div><div><h3>${esc(c.area)}</h3><p>${esc(c.evidencia)}</p></div></div>`
    })
    .join("")
  const leaks = d.vazamentos
    .map(
      (v, i) =>
        `<div class="card leak"><div class="num">${i + 1}</div><div><h3>${esc(v.titulo)}</h3><dl><dt>O que eu vi</dt><dd>${esc(v.visto)}</dd><dt>Por que custa cliente</dt><dd>${esc(v.custo)}</dd></dl></div></div>`,
    )
    .join("")
  const acoes = d.acoes
    .map((a, i) => `<div class="acao"><div class="n">${i + 1}</div><div><h3>${esc(a.titulo)}</h3><p>${esc(a.detalhe)}</p></div></div>`)
    .join("")
  const nv = [...(d.nao_verificado || []), ...d.checks.filter((c) => c.status === "nv").map((c) => `${c.area}: ${c.evidencia}`)]
  const nvTexto = nv.length
    ? `<p class="foot"><b>O que eu não consegui verificar:</b> ${nv.map(esc).join(" ")} Se você me mandar o que faltou, eu completo esse ponto.</p>`
    : ""
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Raio-X de Anúncios - ${esc(d.negocio)}</title><style>${fontesCss()}</style></head><body><div class="page">
<div class="logo">${svg("logo-horizontal-positivo.svg")}</div>
<div class="head"><div class="label">Raio-X de Anúncios<span>${esc(d.data)}</span></div><h1>${esc(d.negocio)}</h1><div class="meta">${metaLinha(d)}</div></div>
<div class="resumo"><div class="label">Em uma frase</div><p>${esc(d.resumo)}</p></div>
<h2>O que eu olhei<small>6 pontos</small></h2>
<div class="card checks">${checks}</div>
<h2>Os 3 vazamentos<small>onde você perde cliente hoje</small></h2>
${leaks}
<h2>As 3 primeiras ações<small>nesta ordem</small></h2>
<div class="card acoes">${acoes}</div>
<div class="cta"><div class="label">Próximo passo</div><h2>Quer isso funcionando <em>no seu negócio?</em></h2>
<div class="offer"><span class="price">R$97</span><span class="what">no 1º mês, pagamento único</span></div>
<ul><li>Conta, públicos e pagamento configurados, com até 2 campanhas no ar.</li><li>Se a estrutura e as campanhas não estiverem no ar em 7 dias, devolvo os R$97.</li><li>Você fala direto comigo, do primeiro contato ao relatório do mês.</li></ul>
<div class="btn">Responda esta conversa no Direct</div><div class="site">cloviseduardo.com</div></div>
${nvTexto}
<p class="foot">Análise feita em ${esc(d.data)} apenas com informações públicas do negócio. Não tive acesso à conta de anúncios nem aos números internos. Verba de anúncio é paga direto à plataforma, separada do valor acima.</p>
</div></body></html>`
}

function capaHtml(d) {
  const chips = d.checks
    .map((c) => {
      const s = STATUS[c.status]
      const cor = { ok: "#8FD1A5", atencao: "#E5C07B", critico: "#E3876A", nv: "#C9C1B2" }[c.status]
      return `<div class="chip"><b>${esc(c.area)}</b><span style="color:${cor}">${s.label}</span></div>`
    })
    .join("")
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${fontesCss()}</style></head><body class="capa"><div class="page">
<div class="logo">${svg("logo-horizontal-negativo.svg")}</div>
<div class="head"><div class="label">Raio-X de Anúncios<span>${esc(d.data)}</span></div><h1>${esc(d.negocio)}</h1><div class="meta">${metaLinha(d)}</div></div>
<div class="resumo"><div class="label">Em uma frase</div><p>${esc(d.resumo)}</p></div>
<div class="grid">${chips}</div>
<div class="strip">O Raio-X completo está no PDF<span>3 vazamentos e 3 ações</span></div>
</div></body></html>`
}

// ---------- execução ----------
async function main() {
  const [arq, saidaArg] = process.argv.slice(2)
  if (!arq) throw new Error("Uso: node raiox/gerar.mjs dados.json [pasta_de_saida]")
  const d = JSON.parse(readFileSync(arq, "utf8"))
  const erros = validar(d)
  if (erros.length) {
    console.error("RAIO-X REPROVADO NA VALIDAÇÃO:\n- " + erros.join("\n- "))
    process.exit(2)
  }
  if (!existsSync(path.join(ASSETS, "logo-horizontal-negativo.svg"))) throw new Error("Falta raiox/assets/logo-horizontal-negativo.svg")
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) throw new Error("Chrome/Edge não encontrado. Defina CHROME_PATH.")
  const saida = path.resolve(saidaArg || path.join(path.dirname(arq), "saida"))
  mkdirSync(saida, { recursive: true })
  const base = path.join(saida, `raio-x-${slug(d.negocio)}`)

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 })
    await page.setContent(paginaHtml(d), { waitUntil: "load" })
    await page.evaluate("document.fonts.ready")
    const altura = await page.evaluate("document.documentElement.scrollHeight")
    await page.screenshot({ path: `${base}.png`, fullPage: true })
    await page.pdf({ path: `${base}.pdf`, width: "1080px", height: `${altura}px`, printBackground: true, pageRanges: "1" })

    const capa = await browser.newPage()
    await capa.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 })
    await capa.setContent(capaHtml(d), { waitUntil: "load" })
    await capa.evaluate("document.fonts.ready")
    const folga = await capa.evaluate("document.querySelector('.strip').getBoundingClientRect().top - document.querySelector('.grid').getBoundingClientRect().bottom")
    await capa.screenshot({ path: `${base}-capa.png`, clip: { x: 0, y: 0, width: 1080, height: 1350 } })
    if (folga < 16) {
      console.error(`CAPA ESTOUROU em ${Math.round(16 - folga)}px: encurte o resumo ou o nome do negócio.`)
      process.exit(3)
    }
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ pdf: `${base}.pdf`, capa: `${base}-capa.png`, altura: undefined }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
