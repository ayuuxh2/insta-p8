// Builds a carousel from <dir>/carrossel.json:
//   node carrossel/kit/build.mjs <dir>
// Output: <dir>/html/slide-N.html and <dir>/out/slide-N.jpg (1080×1350, JPEG as Instagram requires).
//
// carrossel.json:
// {
//   "keyword": "QUERO",
//   "slides": [
//     { "type": "cover", "kicker": "...", "title": "Texto com *destaque*", "subtitle": "...", "image": "foto-1.jpg", "focus": "70% 80%", "zoom": 1.4 },
//     { "type": "feature", "badge": "...", "title": "...", "text": "...", "image": "...", "focus": "..." },
//     { "type": "benefits", "kicker": "...", "title": "...", "items": [{ "title": "...", "text": "..." }] },
//     { "type": "steps", "title": "...", "items": [{ "title": "...", "text": "..." }], "image": "...", "focus": "..." },
//     { "type": "cta", "title": "Quer o link?", "text": "...", "note": "...", "image": "..." }
//   ]
// }

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { TEMPLATES } from "./templates.mjs"

const require = createRequire(import.meta.url)
const sharp = require("sharp")

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean)

const dir = path.resolve(process.argv[2] || ".")
const spec = JSON.parse(readFileSync(path.join(dir, "carrossel.json"), "utf8"))
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) throw new Error("Chrome/Edge não encontrado. Defina CHROME_PATH.")
if (!spec.slides?.length) throw new Error("carrossel.json sem slides")
if (spec.slides.length > 10) throw new Error("O Instagram aceita no máximo 10 slides por carrossel")

const htmlDir = path.join(dir, "html")
const outDir = path.join(dir, "out")
for (const d of [htmlDir, outDir]) {
  if (existsSync(d)) rmSync(d, { recursive: true })
  mkdirSync(d, { recursive: true })
}

const total = spec.slides.length
const results = []
spec.slides.forEach((slide, i) => {
  const template = TEMPLATES[slide.type]
  if (!template) throw new Error(`Tipo de slide desconhecido: ${slide.type}`)
  const s = { ...slide, image: slide.image ? path.resolve(dir, slide.image) : undefined }
  if (s.image && !existsSync(s.image)) throw new Error(`Foto não encontrada: ${slide.image}`)
  const html = template(s, { index: i + 1, total, keyword: (spec.keyword || "QUERO").toUpperCase() })
  const htmlPath = path.join(htmlDir, `slide-${i + 1}.html`)
  writeFileSync(htmlPath, html)
  const png = path.join(outDir, `slide-${i + 1}.png`)
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--allow-file-access-from-files",
    "--virtual-time-budget=6000",
    "--window-size=1080,1350",
    `--screenshot=${png}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: "ignore" })
  results.push(png)
})

for (const png of results) {
  const jpg = png.replace(/\.png$/, ".jpg")
  await sharp(png).resize(1080, 1350, { fit: "cover" }).jpeg({ quality: 92, mozjpeg: true }).toFile(jpg)
  rmSync(png)
  const meta = await sharp(jpg).metadata()
  console.log(`${path.basename(jpg)}  ${meta.width}x${meta.height}`)
}
console.log(`Pronto: ${results.length} slides em ${outDir}`)
