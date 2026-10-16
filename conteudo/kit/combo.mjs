// Builds a "combo" carousel: cover image + one finished Reel per product (as 4:5 video) + CTA slide.
//   node conteudo/kit/combo.mjs <dir>
// Output: <dir>/out/slide-1.jpg, slide-2.mp4 … slide-N.mp4, slide-(N+1).jpg  (ready for agendar.mjs, kind "carousel")
//
// <dir>/combo.json:
// {
//   "keyword": "COMBO",
//   "cover": { "kicker": "Dia das Crianças", "title": "Texto com *destaque*", "subtitle": "...", "image": "../fotos/x.jpg", "focus": "50% 40%" },
//   "cta": { "title": "Quer todos os links?", "text": "que eu te mando *todos* no direct 📩", "image": "../fotos/y.jpg" },
//   "reels": ["../dino-r1", "../blocos-r1"]          // folders with out/reel.mp4 (2 to 8)
// }
// Instagram crops carousel items to the first item's ratio (4:5), which would cut the Reel's title and captions,
// so each Reel is fitted whole into 1080×1350 over a blurred copy of itself.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { ROOT, ffmpeg, mediaDuration, readJson, resetDir } from "./common.mjs"

const dir = path.resolve(process.argv[2] || ".")
const spec = readJson(path.join(dir, "combo.json"))
const reels = (spec.reels || []).map((r) => path.resolve(dir, r, "out/reel.mp4"))
if (reels.length < 2 || reels.length > 8) throw new Error("O combo precisa de 2 a 8 Reels (o carrossel aceita 10 itens com capa e chamada)")
for (const r of reels) if (!existsSync(r)) throw new Error(`Reel não encontrado (gere antes): ${path.relative(dir, r)}`)

const out = path.join(dir, "out")
const work = path.join(dir, ".build")
resetDir(work)
mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (/^slide-\d+\.(jpg|mp4)$/.test(f)) rmSync(path.join(out, f))

// Cover and CTA with the carousel kit (images resolved relative to this folder).
const abs = (s) => (s?.image ? { ...s, image: path.resolve(dir, s.image) } : s)
const carouselDir = path.join(work, "capa")
mkdirSync(carouselDir, { recursive: true })
writeFileSync(
  path.join(carouselDir, "carrossel.json"),
  JSON.stringify({
    keyword: spec.keyword,
    slides: [
      { type: "cover", ...abs(spec.cover) },
      { type: "cta", counter: false, title: "Quer todos os links?", text: "que eu te mando *todos* no direct 📩", ...abs(spec.cta) },
    ],
  }),
)
execFileSync(process.execPath, [path.join(ROOT, "carrossel/kit/build.mjs"), carouselDir], { stdio: "inherit" })

const last = reels.length + 2
copyFileSync(path.join(carouselDir, "out/slide-1.jpg"), path.join(out, "slide-1.jpg"))
copyFileSync(path.join(carouselDir, "out/slide-2.jpg"), path.join(out, `slide-${last}.jpg`))

reels.forEach((reel, i) => {
  const target = path.join(out, `slide-${i + 2}.mp4`)
  ffmpeg([
    "-i", reel,
    "-filter_complex",
    "[0:v]split[a][b];[a]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,boxblur=28:2,eq=brightness=-0.18[bg];[b]scale=-2:1350[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]",
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    target,
  ])
  console.log(`slide-${i + 2}.mp4  ${mediaDuration(target).toFixed(1)}s  (${path.basename(path.dirname(path.dirname(reel)))})`)
})
console.log(`Pronto: capa + ${reels.length} vídeos + chamada em ${out}`)
