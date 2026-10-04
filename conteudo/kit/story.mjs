// Builds Story images (1080×1920 JPEG) from product photos:
//   node conteudo/kit/story.mjs <dir>
// Output: <dir>/out/story-N.jpg
//
// <dir>/stories.json:
// {
//   "keyword": "PONTO",                          // the reply word (same as the product's post.json)
//   "stories": [
//     { "type": "produto", "image": "../fotos/termo-1.jpg", "kicker": "Achadinho do dia", "title": "Churrasco *sem chute*", "text": "..." },
//     { "type": "pergunta", "title": "Você corta a carne pra ver o ponto?", "text": "Responda SIM ou NÃO 👇" },
//     { "type": "novo-post", "image": "out/capa.jpg", "title": "Saiu vídeo novo!" },
//     { "type": "link", "image": "../fotos/termo-2.jpg", "title": "Quer o link?" }
//   ]
// }
// Types: produto (photo + benefit), pergunta (text only, invites replies), novo-post (points to the newest post),
// link ("Responda PALAVRA" call). Fields: image, focus, zoom, kicker, title (*highlight*, \n), text.
// Instagram does not let apps add stickers (link, poll), so the call to action is "reply to this Story":
// replies with the keyword trigger the product's rule (scheduled by agendar.mjs).

import { existsSync } from "node:fs"
import path from "node:path"
import { BRAND, FONTS, brandAsset, esc, fileUrl, openRenderer, readJson, resetDir, rich, sharp } from "./common.mjs"

const dir = path.resolve(process.argv[2] || ".")
const spec = readJson(path.join(dir, "stories.json"))
if (!spec.stories?.length) throw new Error("stories.json sem stories")
const keyword = String(spec.keyword || "").toUpperCase()
const out = path.join(dir, "out")
const work = path.join(dir, ".build")
resetDir(work)
// Keeps other files in out/ (the Reel lives there too); only story-N.jpg are replaced.

const page = (body, background = BRAND.navyDeep) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${FONTS}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; }
  body { font-family: "Inter", system-ui, sans-serif; background: ${background}; color: #fff; position: relative; -webkit-font-smoothing: antialiased; }
  .display { font-family: "Fraunces", Georgia, serif; font-weight: 900; letter-spacing: -0.02em; line-height: 1.0; }
  .hl { color: ${BRAND.accent}; }
  .kicker { display: inline-block; padding: 14px 28px; border-radius: 999px; background: ${BRAND.accent}; color: ${BRAND.navyDeep}; font-size: 32px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
  .reply { position: absolute; left: 70px; right: 70px; bottom: 330px; padding: 34px 40px; border-radius: 36px; background: rgba(255,255,255,0.96); color: ${BRAND.navyDeep}; text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
  .reply b { display: inline-block; margin: 0 6px; padding: 2px 18px; border-radius: 14px; background: ${BRAND.accent}; }
</style></head><body>${body}</body></html>`

const photo = (src, focus = "50% 50%", zoom = 1, size = "cover") =>
  `background-image:url('${fileUrl(src)}');background-size:${zoom === 1 ? size : `${zoom * 100}%`};background-position:${focus};background-repeat:no-repeat;`

const replyBox = (text) => `<div class="reply"><p style="font-size:44px;font-weight:800;line-height:1.3">${text}</p></div>`
const logo = `<img src="${brandAsset("logo-dark.png")}" style="position:absolute;left:70px;top:150px;height:64px">`
const blurred = (src, focus) => `<div style="position:absolute;inset:-80px;${photo(src, focus)}filter:blur(40px) brightness(0.5) saturate(1.15);"></div>`
const card = (s, top, height) =>
  `<div style="position:absolute;left:70px;right:70px;top:${top}px;height:${height}px;border-radius:44px;overflow:hidden;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,0.45);${photo(s.image, s.focus, s.zoom || 1, s.fit === "cover" ? "cover" : "contain")}"></div>`

const TEMPLATES = {
  produto: (s) =>
    page(`${blurred(s.image, s.focus)}${logo}
${card(s, 300, 860)}
<div style="position:absolute;left:70px;right:70px;top:1200px;">
  ${s.kicker ? `<div class="kicker" style="margin-bottom:26px">${esc(s.kicker)}</div>` : ""}
  <h1 class="display" style="font-size:${s.titleSize || 84}px">${rich(s.title)}</h1>
  ${s.text ? `<p style="margin-top:20px;font-size:40px;line-height:1.3;font-weight:600;color:rgba(255,255,255,0.88)">${rich(s.text)}</p>` : ""}
</div>
${keyword ? `<div style="position:absolute;left:70px;right:70px;bottom:250px;text-align:center;font-size:36px;font-weight:700;color:rgba(255,255,255,0.85)">Responda <b style="color:${BRAND.accent}">${esc(keyword)}</b> e receba o link 📩</div>` : ""}`),

  pergunta: (s) =>
    page(`${s.image ? blurred(s.image, s.focus) : ""}${logo}
<div style="position:absolute;left:80px;right:80px;top:520px;">
  ${s.kicker ? `<div class="kicker" style="margin-bottom:34px">${esc(s.kicker)}</div>` : ""}
  <h1 class="display" style="font-size:${s.titleSize || 104}px">${rich(s.title)}</h1>
  ${s.text ? `<p style="margin-top:40px;font-size:46px;line-height:1.3;font-weight:600;color:rgba(255,255,255,0.9)">${rich(s.text)}</p>` : ""}
</div>
${replyBox("Responda aqui embaixo 👇")}`, `radial-gradient(120% 80% at 100% 0%, #135574 0%, ${BRAND.navy} 45%, ${BRAND.navyDeep} 100%)`),

  "novo-post": (s) =>
    page(`${blurred(s.image, s.focus)}${logo}
<div style="position:absolute;left:70px;right:70px;top:290px;text-align:center"><div class="kicker">${esc(s.kicker || "Post novo")}</div>
  <h1 class="display" style="margin-top:30px;font-size:${s.titleSize || 88}px">${rich(s.title || "Saiu vídeo *novo!*")}</h1></div>
<div style="position:absolute;left:190px;right:190px;top:600px;height:940px;border-radius:44px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.5);border:6px solid #fff;${photo(s.image, s.focus || "50% 0%", s.zoom || 1)}"></div>
<div style="position:absolute;left:70px;right:70px;bottom:250px;text-align:center;font-size:40px;font-weight:700">${rich(s.text || "Toque no nosso perfil e assista 👆")}</div>`),

  link: (s) =>
    page(`${blurred(s.image, s.focus)}${logo}
${card(s, 300, 900)}
<div style="position:absolute;left:70px;right:70px;top:1250px;text-align:center">
  <h1 class="display" style="font-size:${s.titleSize || 92}px">${rich(s.title || "Quer o *link?*")}</h1>
</div>
${replyBox(`Responda <b>${esc(keyword || "EU QUERO")}</b> que eu<br>te mando no direct 📩`)}`),
}

const renderer = await openRenderer()
try {
  for (let i = 0; i < spec.stories.length; i++) {
    const s = { ...spec.stories[i] }
    const template = TEMPLATES[s.type || "produto"]
    if (!template) throw new Error(`Tipo de story desconhecido: ${s.type}`)
    if (s.image) {
      s.image = path.resolve(dir, s.image)
      if (!existsSync(s.image)) throw new Error(`Foto não encontrada: ${spec.stories[i].image}`)
    } else if (s.type !== "pergunta") throw new Error(`Story ${i + 1} sem foto`)
    if (["produto", "link"].includes(s.type || "produto") && !keyword) throw new Error("stories.json sem keyword")
    const png = await renderer.render(template(s), path.join(work, `story-${i + 1}.png`))
    const jpg = path.join(out, `story-${i + 1}.jpg`)
    if (!existsSync(out)) resetDir(out)
    await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toFile(jpg)
    console.log(`story-${i + 1}.jpg  (${s.type || "produto"})`)
  }
} finally {
  await renderer.close()
}
console.log(`Pronto: ${spec.stories.length} stories em ${out}`)
