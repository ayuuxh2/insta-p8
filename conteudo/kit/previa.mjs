// Week preview for approval: one image per day with every scheduled item (time, type, thumbnail).
//   node conteudo/kit/previa.mjs <semana>
// Output: <semana>/previa/dia-AAAA-MM-DD.jpg

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { ffmpeg, readJson, resetDir, sharp } from "./common.mjs"

const week = path.resolve(process.argv[2] || ".")
const agenda = readJson(path.join(week, "agenda.json"))
const outDir = path.join(week, "previa")
resetDir(outDir)

const KIND = { reel: "REEL", carousel: "CARROSSEL", image: "FOTO", story: "STORY" }
const TW = 270
const TH = 480
const toDate = (when) => new Date(`${String(when).trim().replace(" ", "T")}${/[+-]\d\d:\d\d$|Z$/.test(when) ? "" : "-03:00"}`)
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")

function thumbSource(entry) {
  const dir = path.join(week, entry.dir || "")
  if (entry.media) {
    const file = path.join(dir, entry.media)
    if (!/\.mp4$/i.test(file)) return file
    const capa = path.join(path.dirname(file), "capa.jpg")
    if (existsSync(capa)) return capa
    const frame = path.join(outDir, `frame-${Math.random().toString(36).slice(2)}.jpg`)
    ffmpeg(["-ss", "0.1", "-i", file, "-frames:v", "1", frame])
    return frame
  }
  if (entry.kind === "reel") return path.join(dir, "out/capa.jpg")
  const slides = existsSync(path.join(dir, "out")) ? readdirSync(path.join(dir, "out")).filter((f) => /^slide-1\.jpg$/.test(f)) : []
  return slides.length ? path.join(dir, "out", slides[0]) : null
}

const byDay = new Map()
for (const entry of agenda.posts || []) {
  const when = toDate(entry.when)
  const day = when.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
  byDay.set(day, [...(byDay.get(day) || []), { ...entry, when }])
}

for (const [day, list] of [...byDay.entries()].sort()) {
  list.sort((a, b) => a.when - b.when)
  const tiles = []
  for (const entry of list) {
    const src = thumbSource(entry)
    const img = src && existsSync(src)
      ? await sharp(src).resize(TW, TH, { fit: entry.kind === "carousel" ? "contain" : "cover", background: "#082736" }).toBuffer()
      : await sharp({ create: { width: TW, height: TH, channels: 3, background: "#444" } }).png().toBuffer()
    const hhmm = entry.when.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    const label = Buffer.from(`<svg width="${TW}" height="70" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0D3B4F"/>
<text x="12" y="30" font-family="Arial" font-weight="700" font-size="24" fill="#F2B134">${hhmm}  ${KIND[entry.kind] || entry.kind}</text>
<text x="12" y="58" font-family="Arial" font-size="17" fill="#fff">${esc(String(entry.label || entry.dir).slice(0, 28))}</text></svg>`)
    tiles.push(await sharp({ create: { width: TW, height: TH + 70, channels: 3, background: "#082736" } }).composite([{ input: label, top: 0, left: 0 }, { input: img, top: 70, left: 0 }]).png().toBuffer())
  }
  const gap = 16
  const width = tiles.length * TW + (tiles.length + 1) * gap
  const title = Buffer.from(`<svg width="${width}" height="70" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="48" font-family="Arial" font-weight="700" font-size="34" fill="#fff">${new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} · ${tiles.length} posts</text></svg>`)
  await sharp({ create: { width, height: TH + 70 + 70 + gap, channels: 3, background: "#10222B" } })
    .composite([{ input: title, top: 0, left: 0 }, ...tiles.map((t, i) => ({ input: t, top: 70, left: gap + i * (TW + gap) }))])
    .jpeg({ quality: 85 })
    .toFile(path.join(outDir, `dia-${day}.jpg`))
  console.log(`previa/dia-${day}.jpg  (${tiles.length} posts)`)
}
for (const f of readdirSync(outDir)) if (f.startsWith("frame-")) await import("node:fs").then((fs) => fs.rmSync(path.join(outDir, f)))
