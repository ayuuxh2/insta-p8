// CEE Store carousel kit — slide templates (1080×1350, Instagram 4:5).
// Each template returns a full HTML document; build.mjs renders it to an image with headless Chrome.
//
// Text fields accept *asterisks* to highlight words in the accent color, and \n for line breaks.

import { pathToFileURL } from "node:url"
import path from "node:path"

const KIT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const BRAND_DIR = path.resolve(KIT_DIR, "../../public/brand")
const asset = (file) => pathToFileURL(path.join(BRAND_DIR, file)).href

export const BRAND = {
  navy: "#0D3B4F",
  navyDeep: "#082736",
  cream: "#F6F1E7",
  accent: "#F2B134",
  ink: "#10222B",
  muted: "#5B6B73",
  handle: "@cee_webstore",
}

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// *word* → highlighted span; \n → <br>
// (highlighted words never break apart across lines)
const rich = (s = "") =>
  esc(s)
    .replace(/\*(.+?)\*/g, (_, words) => `<span class="hl">${words.replace(/ /g, "&nbsp;")}</span>`)
    .replace(/\n/g, "<br>")

function page({ body, background, counter, total, dark }) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800;9..144,900&family=Inter:wght@400;500;600;700;800&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; }
  body { font-family: "Inter", system-ui, sans-serif; background: ${background}; color: ${dark ? "#fff" : BRAND.ink}; position: relative; -webkit-font-smoothing: antialiased; }
  .display { font-family: "Fraunces", Georgia, serif; font-weight: 800; letter-spacing: -0.02em; line-height: 0.98; }
  .hl { color: ${BRAND.accent}; }
  .light .hl { color: ${BRAND.navy}; background: linear-gradient(transparent 62%, ${BRAND.accent} 62%, ${BRAND.accent} 92%, transparent 92%); padding: 0 6px; }
  .counter { position: absolute; top: 56px; right: 64px; font-size: 26px; font-weight: 700; letter-spacing: 0.08em; opacity: 0.75; }
  .handle { position: absolute; bottom: 52px; left: 64px; font-size: 26px; font-weight: 600; opacity: 0.8; }
  .logo { position: absolute; bottom: 44px; right: 64px; height: 58px; }
  .kicker { display: inline-block; font-size: 26px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; padding: 12px 22px; border-radius: 999px; background: ${BRAND.accent}; color: ${BRAND.navyDeep}; }
</style></head>
<body class="${dark ? "dark" : "light"}">
${body}
${counter ? `<div class="counter">${counter}/${total}</div>` : ""}
</body></html>`
}

const photo = (src, focus = "50% 50%", zoom = 1) =>
  `background-image:url('${pathToFileURL(src).href}');background-size:${zoom === 1 ? "cover" : `${zoom * 100}%`};background-position:${focus};background-repeat:no-repeat;`

/** Cover: full-bleed photo, dark gradient, huge hook. */
export function cover(s, ctx) {
  return page({
    background: BRAND.navyDeep,
    dark: true,
    body: `
<div style="position:absolute;inset:0;${photo(s.image, s.focus, s.zoom)}"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,39,54,0.15) 0%, rgba(8,39,54,0.25) 35%, rgba(8,39,54,0.92) 62%, ${BRAND.navyDeep} 100%);"></div>
<img class="logo" style="top:56px;left:64px;bottom:auto;right:auto;height:64px" src="${asset("logo-dark.png")}">
<div style="position:absolute;left:64px;right:64px;bottom:150px;">
  ${s.kicker ? `<div class="kicker" style="margin-bottom:34px">${esc(s.kicker)}</div>` : ""}
  <h1 class="display" style="font-size:${s.titleSize || 118}px;font-weight:900;color:#fff;">${rich(s.title)}</h1>
  ${s.subtitle ? `<p style="margin-top:30px;font-size:36px;line-height:1.3;font-weight:500;color:rgba(255,255,255,0.88);max-width:900px">${rich(s.subtitle)}</p>` : ""}
</div>
<div style="position:absolute;left:64px;right:64px;bottom:56px;display:flex;justify-content:space-between;align-items:center;font-size:26px;font-weight:700;color:rgba(255,255,255,0.85)">
  <span>${BRAND.handle}</span><span>Arraste para o lado &rarr;</span>
</div>`,
  })
}

/** Feature: photo card on cream background + title and text. */
export function feature(s, ctx) {
  return page({
    background: BRAND.cream,
    counter: ctx.index,
    total: ctx.total,
    body: `
<div style="position:absolute;top:120px;left:64px;right:64px;height:740px;border-radius:36px;overflow:hidden;box-shadow:0 24px 60px rgba(13,59,79,0.18);${photo(s.image, s.focus, s.zoom)}"></div>
${s.badge ? `<div class="kicker" style="position:absolute;top:150px;left:96px">${esc(s.badge)}</div>` : ""}
<div style="position:absolute;left:64px;right:64px;top:880px;bottom:130px;display:flex;flex-direction:column;justify-content:center">
  <h2 class="display" style="font-size:${s.titleSize || 80}px;color:${BRAND.navy}">${rich(s.title)}</h2>
  <p style="margin-top:24px;font-size:35px;line-height:1.38;color:${BRAND.muted};font-weight:500">${rich(s.text)}</p>
</div>
<div class="handle" style="color:${BRAND.navy}">${BRAND.handle}</div>
<img class="logo" src="${asset("logo.png")}">`,
  })
}

/** Benefits: navy background, title and 3–4 checked items. */
export function benefits(s, ctx) {
  const items = (s.items || []).slice(0, 4)
  return page({
    background: `radial-gradient(120% 80% at 100% 0%, #135574 0%, ${BRAND.navy} 45%, ${BRAND.navyDeep} 100%)`,
    dark: true,
    counter: ctx.index,
    total: ctx.total,
    body: `
<div style="position:absolute;left:64px;right:64px;top:110px;bottom:140px;display:flex;flex-direction:column;justify-content:center">
  ${s.kicker ? `<div><span class="kicker" style="margin-bottom:30px">${esc(s.kicker)}</span></div>` : ""}
  <h2 class="display" style="font-size:${s.titleSize || 92}px;color:#fff">${rich(s.title)}</h2>
  <ul style="list-style:none;margin-top:72px;display:flex;flex-direction:column;gap:46px">
    ${items
      .map(
        (it) => `<li style="display:flex;gap:30px;align-items:flex-start">
      <span style="flex:none;width:64px;height:64px;border-radius:50%;background:${BRAND.accent};color:${BRAND.navyDeep};display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900">&#10003;</span>
      <div><p style="font-size:42px;font-weight:800;line-height:1.15">${rich(it.title)}</p>${it.text ? `<p style="margin-top:8px;font-size:32px;line-height:1.35;color:rgba(255,255,255,0.78)">${rich(it.text)}</p>` : ""}</div>
    </li>`,
      )
      .join("")}
  </ul>
</div>
<div class="handle">${BRAND.handle}</div>
<img class="logo" src="${asset("logo-dark.png")}">`,
  })
}

/** Steps: how it works / how to use, numbered, with a round photo. */
export function steps(s, ctx) {
  const items = (s.items || []).slice(0, 4)
  return page({
    background: "#fff",
    counter: ctx.index,
    total: ctx.total,
    body: `
<div style="position:absolute;right:-110px;top:80px;width:600px;height:600px;border-radius:50%;border:14px solid ${BRAND.accent};${photo(s.image, s.focus, s.zoom)}"></div>
<div style="position:absolute;left:64px;width:470px;top:120px;height:520px;display:flex;align-items:center">
  <h2 class="display" style="font-size:${s.titleSize || 84}px;color:${BRAND.navy}">${rich(s.title)}</h2>
</div>
<ol style="list-style:none;position:absolute;left:64px;right:64px;top:720px;bottom:140px;display:flex;flex-direction:column;justify-content:center;gap:44px">
  ${items
    .map(
      (it, i) => `<li style="display:flex;gap:30px;align-items:flex-start">
    <span class="display" style="flex:none;width:78px;height:78px;border-radius:22px;background:${BRAND.navy};color:#fff;display:flex;align-items:center;justify-content:center;font-size:44px">${i + 1}</span>
    <div><p style="font-size:41px;font-weight:800;color:${BRAND.navy};line-height:1.15">${rich(it.title)}</p>${it.text ? `<p style="margin-top:6px;font-size:31px;line-height:1.35;color:${BRAND.muted}">${rich(it.text)}</p>` : ""}</div>
  </li>`,
    )
    .join("")}
</ol>
<div class="handle" style="color:${BRAND.navy}">${BRAND.handle}</div>
<img class="logo" src="${asset("logo.png")}">`,
  })
}

/** CTA: comment keyword to receive the link (followers only). */
export function cta(s, ctx) {
  return page({
    background: BRAND.navy,
    dark: true,
    counter: ctx.index,
    total: ctx.total,
    body: `
${s.image ? `<div style="position:absolute;inset:0;${photo(s.image, s.focus, s.zoom)};opacity:0.22;filter:grayscale(0.3)"></div>` : ""}
<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(13,59,79,0.55), ${BRAND.navy} 70%)"></div>
<div style="position:absolute;left:64px;right:64px;top:110px;bottom:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <h2 class="display" style="font-size:${s.titleSize || 118}px;color:#fff">${rich(s.title || "Quer o link?")}</h2>
  <p style="margin-top:64px;font-size:44px;font-weight:600;color:rgba(255,255,255,0.9)">Comente a palavra</p>
  <div class="display" style="margin-top:30px;padding:34px 80px;border-radius:32px;background:${BRAND.accent};color:${BRAND.navyDeep};font-size:150px;font-weight:900;letter-spacing:0.02em;box-shadow:0 24px 60px rgba(0,0,0,0.35)">${esc(ctx.keyword)}</div>
  <p style="margin-top:64px;font-size:40px;line-height:1.4;color:rgba(255,255,255,0.9)">${rich(s.text || "que eu te mando o link no *direct* 📩")}</p>
  <p style="margin-top:26px;font-size:30px;color:rgba(255,255,255,0.72)">${rich(s.note || "Exclusivo para quem segue a " + BRAND.handle)}</p>
</div>
<img class="logo" style="left:50%;right:auto;transform:translateX(-50%);bottom:64px;height:72px" src="${asset("logo-dark.png")}">`,
  })
}

export const TEMPLATES = { cover, feature, benefits, steps, cta }
