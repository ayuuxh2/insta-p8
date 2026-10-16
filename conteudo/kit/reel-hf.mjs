// Builds a narrated Reel (1080×1920, 30 fps) with HyperFrames (HTML + GSAP rendered by headless Chrome) from the
// same reel.json used by reel.mjs, with a more polished motion style: slow camera moves on the photos, titles that
// rise word by word, highlighted captions, smooth scene transitions, progress bar, sound effects and an animated CTA.
//   node conteudo/kit/reel-hf.mjs <dir>
// Output: <dir>/out/reel.mp4 and <dir>/out/capa.jpg. Work files go to <dir>/.hf/.
//
// Needs: the local narration tools (see common.mjs), `npx hyperframes` (downloaded on first use), and the sound
// effect synthesizer of the /edicao-motion skill (audio.py). reel.json is the same as for reel.mjs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import os from "node:os"
import { BRAND, FFMPEG, closeNarrator, esc, mediaDuration, narrate, readJson, resetDir, sharp, ROOT, KIT_DIR } from "./common.mjs"

const W = 1080
const H = 1920
const FPS = 30
const HF_VERSION = "0.8.154"
const PY = process.env.CEE_PYTHON || "C:/Users/clovi/AppData/Local/Programs/Python/Python312/python.exe"
const SKILL = path.join(os.homedir(), ".claude/skills/edicao-motion")

const dir = path.resolve(process.argv[2] || ".")
const spec = readJson(path.join(dir, "reel.json"))
if (!spec.scenes?.length) throw new Error("reel.json sem cenas")
const keyword = String(spec.keyword || "").toUpperCase()
const work = path.join(dir, ".hf")
const out = path.join(dir, "out")
resetDir(work)
mkdirSync(out, { recursive: true })
const hf = path.join(work, "hf")
const assets = path.join(hf, "assets")
mkdirSync(assets, { recursive: true })

// ---------- Fonts: Nunito (variable) stored once next to the kit so renders do not depend on the network ----------
async function ensureFont() {
  const cache = path.join(KIT_DIR, "assets")
  mkdirSync(cache, { recursive: true })
  const want = { latin: path.join(cache, "Nunito-latin.woff2"), "latin-ext": path.join(cache, "Nunito-latin-ext.woff2") }
  if (Object.values(want).every(existsSync)) return want
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Nunito:wght@400..900&display=swap", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" },
  })).text()
  for (const block of css.split("@font-face").slice(1)) {
    const subset = block.match(/\/\* ([\w-]+) \*\//)?.[1]
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1]
    if (want[subset] && url) writeFileSync(want[subset], Buffer.from(await (await fetch(url)).arrayBuffer()))
  }
  if (!Object.values(want).every(existsSync)) throw new Error("Não foi possível baixar a fonte Nunito")
  return want
}
const fonts = await ensureFont()
copyFileSync(fonts.latin, path.join(assets, "Nunito-latin.woff2"))
copyFileSync(fonts["latin-ext"], path.join(assets, "Nunito-latin-ext.woff2"))
copyFileSync(path.join(SKILL, "template/assets/gsap.min.js"), path.join(assets, "gsap.min.js"))
copyFileSync(path.join(ROOT, "public/brand/logo-dark.png"), path.join(assets, "logo.png"))
writeFileSync(path.join(hf, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" }, media: { autoProxy: true } }, null, 2))
writeFileSync(path.join(hf, "meta.json"), JSON.stringify({ id: "reel-" + path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: path.basename(dir) }))

// ---------- Narration per scene, scene timeline ----------
const scenes = []
let t0 = 0
for (let i = 0; i < spec.scenes.length; i++) {
  const s = spec.scenes[i]
  if (!s.say) throw new Error(`Cena ${i + 1} sem narração ("say")`)
  const n = await narrate(s.say, work, `voz-${i + 1}`, { voice: spec.voice, rate: spec.rate })
  const type = s.type || "point"
  const tail = type === "hook" ? 0.28 : type === "cta" ? 0.9 : 0.4
  const dur = Math.max(n.duration + tail, type === "cta" ? 3.2 : 1.8)
  let image = null
  if (s.image) {
    const src = path.resolve(dir, s.image)
    image = `foto-${i + 1}.jpg`
    await sharp(src).rotate().resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(path.join(assets, image))
  }
  const words = (n.words.length ? n.words : s.say.split(/\s+/).map((t, k, a) => ({ text: t, start: (k * n.duration) / a.length, end: ((k + 1) * n.duration) / a.length })))
    .map((w) => ({ t: w.text, s: +(t0 + w.start).toFixed(3), e: +(t0 + w.end).toFixed(3) }))
  scenes.push({ i, type, start: +t0.toFixed(3), dur: +dur.toFixed(3), kicker: s.kicker || "", title: s.title || "", image, focus: s.focus || "50% 50%", zoom: s.zoom || 1, words, audio: n.file, audioDur: dur })
  t0 += dur
}
closeNarrator()
const TOTAL = Math.floor(t0 * FPS) / FPS

// Voice track: every narration padded to its scene length, joined.
{
  const inputs = scenes.flatMap((s) => ["-i", s.audio])
  const filters = scenes.map((s, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=whole_dur=${s.audioDur.toFixed(3)},atrim=0:${s.audioDur.toFixed(3)}[a${i}]`)
  const concat = scenes.map((_, i) => `[a${i}]`).join("") + `concat=n=${scenes.length}:v=0:a=1[o]`
  const r = spawnSync(FFMPEG, ["-y", "-v", "error", ...inputs, "-filter_complex", [...filters, concat].join(";"), "-map", "[o]", path.join(work, "voz.wav")], { encoding: "utf8" })
  if (r.status !== 0) throw new Error("ffmpeg (voz): " + r.stderr)
}

// ---------- HTML ----------
const css = `
@font-face{font-family:"Nunito";font-weight:200 1000;src:url(assets/Nunito-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Nunito";font-weight:200 1000;src:url(assets/Nunito-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--navy:${BRAND.navy};--deep:${BRAND.navyDeep};--cream:${BRAND.cream};--amber:${BRAND.accent};--terra:#D9653B}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--deep);font-family:"Nunito",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(180deg,#0D3B4F 0%,#082736 70%,#061C27 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
#b1{width:760px;height:760px;left:-260px;top:120px;background:rgba(47,107,128,.75)}
#b2{width:620px;height:620px;right:-240px;top:880px;background:rgba(242,177,52,.22)}
#b3{width:700px;height:700px;left:120px;bottom:-300px;background:rgba(47,107,128,.5)}
#vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 55%,rgba(2,14,20,.55) 100%);pointer-events:none}
#logo{position:absolute;left:80px;top:108px;height:60px;opacity:.92}
#prog{position:absolute;left:80px;right:80px;top:196px;height:6px;border-radius:6px;background:rgba(255,255,255,.14);overflow:hidden}
#prog i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--amber);border-radius:6px}
.scene{position:absolute;inset:0;opacity:0}
.kicker{position:absolute;left:80px;top:238px;display:inline-block;padding:10px 24px;border-radius:999px;background:var(--amber);color:#072A38;font-weight:900;font-size:30px;letter-spacing:.12em;text-transform:uppercase}
.title{position:absolute;left:80px;right:80px;top:286px;color:#fff;font-weight:900;line-height:1.03;letter-spacing:-.01em;text-shadow:0 6px 28px rgba(0,0,0,.35)}
.title.nok{top:250px}
.title .wm{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .04em .12em;margin-right:.22em}
.title .w{display:inline-block;will-change:transform}
.title .em .w{color:var(--amber)}
.title .em{background:linear-gradient(var(--amber),var(--amber)) no-repeat 0 94%/0% 8%;border-radius:4px}
.card{position:absolute;left:80px;top:560px;width:920px;height:830px;border-radius:56px;overflow:hidden;background:#fff;box-shadow:0 40px 90px rgba(0,0,0,.5),0 0 0 3px rgba(242,177,52,.0)}
.card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:transform}
.card .sheen{position:absolute;top:0;bottom:0;width:240px;left:-300px;background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.35),rgba(255,255,255,0));transform:skewX(-14deg)}
#caps{position:absolute;left:0;width:${W}px;top:1432px;height:120px}
.cap{position:absolute;left:0;right:0;top:0;text-align:center;visibility:hidden;white-space:nowrap}
.cap .pill{display:inline-block;padding:16px 40px 20px;border-radius:32px;background:rgba(255,255,255,.13);border:2px solid rgba(255,255,255,.2);box-shadow:0 14px 40px rgba(0,0,0,.4)}
.cap .w{display:inline-block;margin:0 .3em;color:#fff;font-size:64px;font-weight:900;text-transform:uppercase;letter-spacing:.01em}
.cta .k1{position:absolute;left:0;right:0;top:470px;text-align:center;color:var(--amber);font-weight:900;font-size:40px;letter-spacing:.2em}
.cta .k2{position:absolute;left:0;right:0;top:560px;text-align:center;color:#fff;font-weight:900;font-size:92px}
.cta .pillw{position:absolute;left:0;right:0;top:720px;text-align:center}
.cta .pillk{display:inline-block;padding:26px 74px 34px;border-radius:44px;background:var(--amber);color:#072A38;font-weight:900;font-size:${keyword.length > 7 ? 148 : 176}px;letter-spacing:.02em;box-shadow:0 30px 70px rgba(242,177,52,.35)}
.cta .ring{position:absolute;left:50%;top:880px;width:520px;height:230px;margin:-115px 0 0 -260px;border-radius:60px;border:5px solid var(--amber);opacity:0}
.cta .k3{position:absolute;left:0;right:0;top:1060px;text-align:center;color:var(--cream);font-weight:800;font-size:54px;line-height:1.2}
.cta .k3 b{color:var(--amber);font-weight:900}
.cta .k4{position:absolute;left:0;right:0;top:1230px;text-align:center;color:rgba(246,241,231,.75);font-weight:700;font-size:34px}
.cta .arrow{position:absolute;left:50%;top:1330px;width:90px;height:90px;margin-left:-45px;display:grid;place-items:center;color:var(--amber);font-size:80px;font-weight:900}
`

const rich = (s) => {
  // "*word*" → highlight; "\n" → line break. Returns [{text, em, br}] tokens, one per word.
  const tokens = []
  const lines = String(s).split("\n")
  lines.forEach((line, li) => {
    const parts = line.split(/(\*[^*]+\*)/).filter(Boolean)
    for (const p of parts) {
      const em = p.startsWith("*") && p.endsWith("*")
      for (const w of (em ? p.slice(1, -1) : p).split(/\s+/).filter(Boolean)) tokens.push({ text: w, em })
    }
    if (li < lines.length - 1) tokens.push({ br: true })
  })
  return tokens
}
const titleHtml = (s) => rich(s).map((t) => (t.br ? "<br>" : `<span class="wm${t.em ? " em" : ""}"><span class="w">${esc(t.text)}</span></span>`)).join("")
const titleSize = (s) => {
  const longest = Math.max(...String(s).replace(/\*/g, "").split("\n").map((l) => l.length), 1)
  const total = String(s).replace(/\*|\n/g, "").length
  return total > 44 ? 74 : longest > 26 || total > 34 ? 84 : 98
}

const sceneHtml = scenes
  .map((s) => {
    if (s.type === "cta") {
      return `<div class="scene cta" id="s${s.i}"><div class="k1">QUER O LINK?</div><div class="k2">Comente</div><div class="ring" id="r${s.i}a"></div><div class="ring" id="r${s.i}b"></div><div class="pillw"><span class="pillk" id="pk${s.i}">${esc(keyword)}</span></div><div class="k3">que eu te mando o link<br>no <b>direct</b></div><div class="k4">Exclusivo para quem segue a ${BRAND.handle}</div><div class="arrow" id="ar${s.i}">&#8595;</div></div>`
    }
    return `<div class="scene" id="s${s.i}">${s.kicker ? `<div class="kicker" id="k${s.i}">${esc(s.kicker)}</div>` : ""}<div class="title${s.kicker ? "" : " nok"}" id="t${s.i}" style="font-size:${titleSize(s.title)}px">${titleHtml(s.title)}</div>${s.image ? `<div class="card" id="c${s.i}"><img id="i${s.i}" src="assets/${s.image}" style="object-position:${s.focus}"><i class="sheen" id="sh${s.i}"></i></div>` : ""}</div>`
  })
  .join("\n")

// Caption chunks (3 words or ~20 characters) with absolute times
const chunks = []
for (const s of scenes) {
  if (s.type === "cta") continue
  let cur = []
  for (const w of s.words) {
    const len = [...cur, w].map((x) => x.t).join(" ").length
    if (cur.length && (cur.length >= 3 || len > 22)) { chunks.push(cur); cur = [] }
    cur.push(w)
  }
  if (cur.length) chunks.push(cur)
}
const capsHtml = chunks.map((c, k) => `<div class="cap" id="cap${k}"><span class="pill">${c.map((w, j) => `<span class="w" id="cw${k}_${j}">${esc(w.t.replace(/[.,;]+$/, ""))}</span>`).join("")}</span></div>`).join("\n")

const script = `
const D = ${TOTAL};
const SC = ${JSON.stringify(scenes.map((s) => ({ i: s.i, type: s.type, start: s.start, dur: s.dur, zoom: s.zoom, hasKicker: !!s.kicker, hasImage: !!s.image })))};
const CH = ${JSON.stringify(chunks.map((c) => c.map((w) => ({ s: w.s, e: w.e }))))};
const AMBER = "${BRAND.accent}";
const SFX = [];
const sfx = (t, type, gain) => SFX.push({ t: +Math.max(0, t).toFixed(3), type, gain: gain == null ? 1 : gain });
const tl = gsap.timeline({ paused: true });
// background life (slow drifts, deterministic)
tl.to("#b1", { x: 180, y: 120, duration: D, ease: "none" }, 0);
tl.to("#b2", { x: -160, y: -140, duration: D, ease: "none" }, 0);
tl.to("#b3", { x: 140, y: -90, duration: D, ease: "none" }, 0);
tl.fromTo("#prog i", { scaleX: 0 }, { scaleX: 1, duration: D, ease: "none" }, 0);
SC.forEach((s, n) => {
  const t = s.start, id = "#s" + s.i, endT = s.start + s.dur;
  const first = n === 0, last = n === SC.length - 1;
  tl.set(id, { opacity: 1 }, Math.max(0, t - 0.04));
  if (!last) tl.to(id, { opacity: 0, y: -36, duration: 0.24, ease: "power2.in" }, endT - 0.2);
  if (s.type === "cta") {
    tl.fromTo(id + " .k1", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, t + 0.05);
    tl.fromTo(id + " .k2", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, t + 0.18);
    tl.fromTo("#pk" + s.i, { scale: 0.4, opacity: 0, rotation: -5 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: "back.out(2.4)" }, t + 0.45);
    ["a", "b"].forEach((c, q) => {
      tl.fromTo("#r" + s.i + c, { scale: 0.85, opacity: 0.9 }, { scale: 1.9, opacity: 0, duration: 1.1, ease: "power2.out" }, t + 0.75 + q * 0.5);
    });
    tl.to("#pk" + s.i, { scale: 1.05, duration: 0.5, yoyo: true, repeat: 3, ease: "sine.inOut" }, t + 1.3);
    tl.fromTo(id + " .k3", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, t + 0.95);
    tl.fromTo(id + " .k4", { opacity: 0 }, { opacity: 1, duration: 0.5 }, t + 1.35);
    tl.fromTo("#ar" + s.i, { y: -14, opacity: 0 }, { y: 14, opacity: 1, duration: 0.6, yoyo: true, repeat: 3, ease: "sine.inOut" }, t + 1.2);
    sfx(t + 0.45, "impacto", 0.9); sfx(t + 0.85, "ding", 0.7);
    return;
  }
  // photo card: enters from below with a slight tilt, then a slow camera move
  if (s.hasImage) {
    const dir = n % 2 ? 1 : -1;
    tl.fromTo("#c" + s.i, { y: 190, scale: 0.9, rotation: 2.2 * dir, opacity: 0 }, { y: 0, scale: 1, rotation: 0, opacity: 1, duration: 0.75, ease: "expo.out" }, t);
    tl.fromTo("#i" + s.i, { scale: 1.02 * s.zoom, x: -18 * dir }, { scale: 1.16 * s.zoom, x: 18 * dir, duration: s.dur + 0.4, ease: "none" }, t);
    tl.fromTo("#sh" + s.i, { x: 0 }, { x: 1500, duration: 0.9, ease: "power2.inOut" }, t + 0.25);
  }
  // title words rise from a mask; highlighted words get a marker sweep
  tl.fromTo(id + " .title .w", { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.55, ease: "power4.out", stagger: 0.07 }, t + 0.08);
  tl.to(id + " .title .em", { backgroundSize: "100% 8%", duration: 0.45, ease: "power2.out", stagger: 0.09 }, t + 0.55);
  if (s.hasKicker) {
    tl.fromTo("#k" + s.i, { scale: 0.5, opacity: 0, y: 14 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: "back.out(2.6)" }, t + 0.04);
    sfx(t + 0.05, "pop", 0.8);
  }
  if (!first) sfx(t - 0.02, "whoosh", 0.75); else sfx(t, "swipe", 0.8);
});
// captions: three-word chunks; the spoken word lights up in amber
CH.forEach((c, k) => {
  const a = c[0].s, next = CH[k + 1] ? CH[k + 1][0].s : c[c.length - 1].e + 0.35;
  tl.set("#cap" + k, { visibility: "visible" }, a);
  tl.fromTo("#cap" + k, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.14, ease: "power2.out" }, a);
  tl.set("#cap" + k, { visibility: "hidden", opacity: 0 }, Math.max(a + 0.1, next - 0.03));
  c.forEach((w, j) => {
    const el = "#cw" + k + "_" + j;
    tl.to(el, { color: AMBER, scale: 1.07, duration: 0.09, ease: "power2.out" }, w.s);
    tl.to(el, { color: "#ffffff", scale: 1, duration: 0.12 }, Math.max(w.s + 0.12, w.e));
  });
});
document.body.setAttribute("data-sfx", JSON.stringify(SFX));
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
tl.seek(0);
`

const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<script src="assets/gsap.min.js"></script>
<style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL.toFixed(3)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
  <i class="blob" id="b1"></i><i class="blob" id="b2"></i><i class="blob" id="b3"></i><div id="vig"></div>
  <img id="logo" src="assets/logo.png" alt=""><div id="prog"><i></i></div>
${sceneHtml}
  <div id="caps">
${capsHtml}
  </div>
</div>
<script>${script}</script>
</body></html>`
writeFileSync(path.join(hf, "index.html"), html)

// ---------- Render, sound effects, final mux ----------
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" && /npx/.test(cmd), ...opts })
  if (r.status !== 0) throw new Error(`${cmd} falhou:\n${(r.stdout || "") + (r.stderr || "")}`.slice(-1800))
  return r.stdout
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx"
run(npx, ["--yes", `hyperframes@${HF_VERSION}`, "check"], { cwd: hf })
mkdirSync(path.join(hf, "renders"), { recursive: true })
run(npx, ["--yes", `hyperframes@${HF_VERSION}`, "render", "-q", "standard", "-w", "4", "-o", "renders/silent.mp4"], { cwd: hf })
run(PY, [path.join(SKILL, "scripts/audio.py"), work, "--musica", "nenhuma", "--voz", path.join(work, "voz.wav")])
copyFileSync(path.join(work, "final.mp4"), path.join(out, "reel.mp4"))
// Cover = a frame where the hook is fully in.
run(FFMPEG, ["-y", "-v", "error", "-ss", "1.1", "-i", path.join(out, "reel.mp4"), "-frames:v", "1", "-q:v", "2", path.join(out, "capa.jpg")])
console.log(`Pronto: ${path.join(out, "reel.mp4")} (${mediaDuration(path.join(out, "reel.mp4")).toFixed(1)}s) + out/capa.jpg`)
