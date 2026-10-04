// Builds a narrated Reel (1080×1920, 30 fps, H.264 + AAC) from product photos:
//   node conteudo/kit/reel.mjs <dir>
// Output: <dir>/out/reel.mp4 and <dir>/out/capa.jpg (cover). Work files go to <dir>/.build/.
//
// <dir>/reel.json:
// {
//   "keyword": "TERMO",                         // shown on the "cta" scene
//   "voice": "pt-BR-FranciscaNeural",           // optional (pt-BR-AntonioNeural, pt-BR-ThalitaMultilingualNeural…)
//   "rate": "+6%",                              // optional speaking speed
//   "music": "../../../musicas/leve.mp3",       // optional background track (relative to <dir>); "none" disables
//   "scenes": [
//     { "type": "hook", "image": "../fotos/termo-1.jpg", "title": "Você vai se perguntar *como viveu sem*",
//       "say": "Você vai se perguntar como viveu sem isso aqui.", "focus": "50% 40%", "zoom": 1, "fit": "cover" },
//     { "image": "...", "title": "Carne no ponto *sem cortar*", "say": "Ele mostra a temperatura em segundos..." },
//     { "type": "cta", "image": "...", "say": "Comente TERMO que eu te mando o link no direct." }
//   ]
// }
// Scene fields: type (hook | point | cta; default point), image, title (*highlight*, \n), say (narration),
// focus ("x% y%"), zoom (≥1), fit ("cover" full-bleed | "card" photo card over blurred background; default:
// cover for portrait photos, card otherwise), motion ("in" | "out"), captions (false to hide them).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BRAND, FONTS, brandAsset, esc, fileUrl, ffmpeg, mediaDuration, narrate, openRenderer, readJson, resetDir, rich, sharp, ROOT } from "./common.mjs"

const W = 1080
const H = 1920
const FPS = 30
const CAPTION_Y = 1250
const CAPTION_H = 300

const dir = path.resolve(process.argv[2] || ".")
const spec = readJson(path.join(dir, "reel.json"))
if (!spec.scenes?.length) throw new Error("reel.json sem cenas")
const keyword = String(spec.keyword || "").toUpperCase()
const build = path.join(dir, ".build")
const out = path.join(dir, "out")
resetDir(build)
mkdirSync(out, { recursive: true })

// ---------- Templates ----------

const base = (body, { transparent = false, width = W, height = H } = {}) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${FONTS}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${transparent ? "transparent" : BRAND.navyDeep}; }
  body { font-family: "Inter", system-ui, sans-serif; color: #fff; position: relative; -webkit-font-smoothing: antialiased; }
  .display { font-family: "Fraunces", Georgia, serif; font-weight: 900; letter-spacing: -0.02em; line-height: 1.0; }
  .hl { color: ${BRAND.accent}; }
</style></head><body>${body}</body></html>`

const photoCss = (src, focus = "50% 50%", zoom = 1) =>
  `background-image:url('${fileUrl(src)}');background-size:${zoom === 1 ? "cover" : `${zoom * 100}%`};background-position:${focus};background-repeat:no-repeat;`

function backgroundHtml(scene) {
  const { image, focus, zoom = 1, fit } = scene
  const shade = `<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,39,54,0.88) 0%, rgba(8,39,54,0.55) 22%, rgba(8,39,54,0) 40%, rgba(8,39,54,0) 58%, rgba(8,39,54,0.55) 72%, rgba(8,39,54,0.9) 100%);"></div>`
  if (scene.type === "cta") {
    return base(`<div style="position:absolute;inset:-60px;${photoCss(image, focus)}filter:blur(28px) brightness(0.5) saturate(1.1);"></div>
<div style="position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 45%, rgba(13,59,79,0.35), rgba(8,39,54,0.85));"></div>`)
  }
  if (fit === "card") {
    return base(`<div style="position:absolute;inset:-80px;${photoCss(image, focus)}filter:blur(40px) brightness(0.55) saturate(1.15);"></div>
<div style="position:absolute;left:70px;right:70px;top:560px;height:940px;border-radius:44px;overflow:hidden;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,0.45);${photoCss(image, focus, zoom)}background-size:${zoom === 1 ? "contain" : `${zoom * 100}%`};"></div>
${shade}`)
  }
  return base(`<div style="position:absolute;inset:0;${photoCss(image, focus, zoom)}"></div>${shade}`)
}

function titleHtml(scene, index, total) {
  if (scene.type === "cta") {
    return base(`<div style="position:absolute;left:80px;right:80px;top:470px;text-align:center;">
  <p style="font-size:54px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.9)">${rich(scene.title || "Quer o link?")}</p>
  <p style="margin-top:70px;font-size:64px;font-weight:700;">Comente</p>
  <div style="display:inline-block;margin-top:26px;padding:26px 64px;border-radius:32px;background:${BRAND.accent};color:${BRAND.navyDeep};font-size:150px;font-weight:900;letter-spacing:0.04em;box-shadow:0 20px 60px rgba(0,0,0,0.35)">${esc(keyword || "EU QUERO")}</div>
  <p style="margin-top:46px;font-size:52px;font-weight:700;line-height:1.25;">que eu te mando<br>o link no direct 📩</p>
  <p style="margin-top:60px;font-size:36px;font-weight:600;color:rgba(255,255,255,0.75)">Exclusivo para quem segue a ${BRAND.handle}</p>
</div>
<img src="${brandAsset("logo-dark.png")}" style="position:absolute;left:50%;transform:translateX(-50%);bottom:430px;height:70px;opacity:0.9">`, { transparent: true })
  }
  if (!scene.title) return null
  const hook = scene.type === "hook"
  const size = scene.titleSize || (hook ? 104 : 84)
  return base(`<div style="position:absolute;left:70px;right:110px;top:${hook ? 250 : 270}px;">
  ${scene.kicker ? `<div style="display:inline-block;margin-bottom:28px;padding:12px 24px;border-radius:999px;background:${BRAND.accent};color:${BRAND.navyDeep};font-size:30px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase">${esc(scene.kicker)}</div>` : ""}
  <h1 class="display" style="font-size:${size}px;text-shadow:0 4px 24px rgba(0,0,0,0.45)">${rich(scene.title)}</h1>
</div>
${hook ? "" : `<div style="position:absolute;right:60px;top:150px;font-size:28px;font-weight:800;letter-spacing:0.08em;opacity:0.7">${index}/${total}</div>`}`, { transparent: true })
}

function captionHtml(words, active) {
  const html = words
    .map((w, i) => `<span style="${i === active ? `color:${BRAND.navyDeep};background:${BRAND.accent};border-radius:14px;padding:0 14px;` : ""}">${esc(w)}</span>`)
    .join(" ")
  return base(`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 90px;">
  <p style="text-align:center;font-size:76px;font-weight:900;line-height:1.25;text-transform:uppercase;-webkit-text-stroke:3px rgba(8,39,54,0.85);paint-order:stroke fill;text-shadow:0 6px 20px rgba(0,0,0,0.6)">${html}</p>
</div>`, { transparent: true, width: W, height: CAPTION_H })
}

// ---------- Captions: group the spoken words into short chunks ----------

function captionChunks(narration, sayText) {
  let words = narration.words
  if (!words.length) {
    // No word timings: spread the words evenly over the audio.
    const tokens = sayText.split(/\s+/).filter(Boolean)
    const step = narration.duration / Math.max(tokens.length, 1)
    words = tokens.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step }))
  }
  const chunks = []
  let current = []
  for (const w of words) {
    const len = [...current, w].map((x) => x.text).join(" ").length
    if (current.length && (current.length >= 3 || len > 20)) {
      chunks.push(current)
      current = []
    }
    current.push(w)
  }
  if (current.length) chunks.push(current)
  return chunks
}

// ---------- Build ----------

function pickMusic() {
  if (spec.music === "none") return null
  if (spec.music) {
    const file = path.resolve(dir, spec.music)
    if (!existsSync(file)) throw new Error(`Música não encontrada: ${spec.music}`)
    return file
  }
  const lib = path.join(ROOT, "conteudo/musicas")
  const tracks = existsSync(lib) ? readdirSync(lib).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)) : []
  return tracks.length ? path.join(lib, tracks[Math.floor(Math.random() * tracks.length)]) : null
}

const renderer = await openRenderer()
const total = spec.scenes.length
const segments = []
const audios = []
let coverParts = null

try {
  for (let i = 0; i < total; i++) {
    const scene = { type: "point", ...spec.scenes[i] }
    if (!scene.image) throw new Error(`Cena ${i + 1} sem foto`)
    scene.image = path.resolve(dir, scene.image)
    if (!existsSync(scene.image)) throw new Error(`Foto não encontrada: ${spec.scenes[i].image}`)
    if (!scene.fit) {
      const meta = await sharp(scene.image).metadata()
      scene.fit = meta.height / meta.width >= 1.25 ? "cover" : "card"
    }
    if (!scene.say) throw new Error(`Cena ${i + 1} sem narração ("say")`)

    const n = i + 1
    const narration = await narrate(scene.say, build, `voz-${n}`, { voice: spec.voice, rate: spec.rate })
    const tail = i === total - 1 ? 1.0 : 0.22
    const duration = Math.max(narration.duration + tail, 1.8)
    const frames = Math.round(duration * FPS)
    audios.push({ file: narration.file, duration: frames / FPS })

    const bg = await renderer.render(backgroundHtml(scene), path.join(build, `bg-${n}.png`))
    const titleMarkup = titleHtml(scene, n, total)
    const title = titleMarkup ? await renderer.render(titleMarkup, path.join(build, `titulo-${n}.png`), { transparent: true }) : null
    if (i === 0) coverParts = { bg, title }

    // One caption image per spoken word (the active word is highlighted).
    const captions = []
    if (scene.captions !== false && scene.type !== "cta") {
      const chunks = captionChunks(narration, scene.say)
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        const chunkEnd = c + 1 < chunks.length ? chunks[c + 1][0].start : duration
        for (let w = 0; w < chunk.length; w++) {
          const start = w === 0 && c === 0 ? 0 : chunk[w].start
          const end = w + 1 < chunk.length ? chunk[w + 1].start : chunkEnd
          if (end - start < 0.02) continue
          const file = await renderer.render(captionHtml(chunk.map((x) => x.text), w), path.join(build, `leg-${n}-${c}-${w}.png`), { width: W, height: CAPTION_H, transparent: true })
          captions.push({ file, start, end })
        }
      }
    }

    // Ken Burns on the background, title (fades in except on the hook) and timed captions.
    const motionIn = (scene.motion || (i % 2 === 0 ? "in" : "out")) === "in"
    const z = motionIn ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`
    const inputs = ["-i", bg]
    const filters = [`[0:v]scale=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1[v0]`]
    let last = "v0"
    let idx = 1
    if (title) {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", duration.toFixed(3), "-i", title)
      const fade = scene.type === "hook" ? "" : ",fade=in:st=0:d=0.3:alpha=1"
      filters.push(`[${idx}:v]format=rgba${fade}[t]`, `[${last}][t]overlay=0:0[v${idx}]`)
      last = `v${idx}`
      idx++
    }
    for (const cap of captions) {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", duration.toFixed(3), "-i", cap.file)
      filters.push(`[${last}][${idx}:v]overlay=0:${CAPTION_Y}:enable='between(t,${cap.start.toFixed(3)},${(cap.end - 0.001).toFixed(3)})'[v${idx}]`)
      last = `v${idx}`
      idx++
    }
    const segment = path.join(build, `cena-${n}.mp4`)
    const graph = path.join(build, `cena-${n}.filter`)
    writeFileSync(graph, filters.join(";\n"))
    ffmpeg([...inputs, "-filter_complex_script", graph, "-map", `[${last}]`, "-frames:v", String(frames), "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", segment])
    segments.push(segment)
    console.log(`cena ${n}/${total}  ${duration.toFixed(1)}s  ${captions.length} legendas  (${scene.fit})`)
  }
} finally {
  await renderer.close()
}

// ---------- Join scenes, narration and music ----------

const list = path.join(build, "cenas.txt")
writeFileSync(list, segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"))
const video = path.join(build, "video.mp4")
ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video])

const totalDuration = audios.reduce((s, a) => s + a.duration, 0)
const audioInputs = audios.flatMap((a) => ["-i", a.file])
const audioFilters = audios.map((a, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=whole_dur=${a.duration.toFixed(3)},atrim=0:${a.duration.toFixed(3)}[a${i}]`)
audioFilters.push(`${audios.map((_, i) => `[a${i}]`).join("")}concat=n=${audios.length}:v=0:a=1,volume=1.15[voz]`)
const music = pickMusic()
let audioOut = "voz"
if (music) {
  audioInputs.push("-stream_loop", "-1", "-i", music)
  const m = audios.length
  audioFilters.push(
    `[${m}:a]aresample=48000,atrim=0:${totalDuration.toFixed(3)},volume=0.13,afade=t=in:d=0.5,afade=t=out:st=${Math.max(totalDuration - 1.2, 0).toFixed(3)}:d=1.2[musica]`,
    `[voz]aformat=channel_layouts=stereo[voz2]`,
    `[voz2][musica]amix=inputs=2:duration=first:normalize=0[mix]`,
  )
  audioOut = "mix"
}
const audio = path.join(build, "audio.m4a")
ffmpeg([...audioInputs, "-filter_complex", audioFilters.join(";"), "-map", `[${audioOut}]`, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", audio])

const reel = path.join(out, "reel.mp4")
ffmpeg(["-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", reel])

// Cover = first frame (background + hook), also used for the profile grid.
const layers = coverParts.title ? [{ input: coverParts.title }] : []
await sharp(coverParts.bg).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(out, "capa.jpg"))

console.log(`Pronto: ${reel} (${mediaDuration(reel).toFixed(1)}s${music ? `, música: ${path.basename(music)}` : ", sem música"}) + out/capa.jpg`)
