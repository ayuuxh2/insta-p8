// Shared helpers for the Reels / Stories kit: headless Chrome rendering, ffmpeg, TTS and the agent API.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
export const KIT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
export const ROOT = path.resolve(KIT_DIR, "../..")
export const FFMPEG = require("ffmpeg-static")
export const sharp = require("sharp")

export const BRAND = {
  navy: "#0D3B4F",
  navyDeep: "#082736",
  cream: "#F6F1E7",
  accent: "#F2B134",
  ink: "#10222B",
  muted: "#5B6B73",
  handle: "@cee_webstore",
}
const BRAND_DIR = path.join(ROOT, "public/brand")
export const brandAsset = (file) => pathToFileURL(path.join(BRAND_DIR, file)).href
export const fileUrl = (p) => pathToFileURL(p).href

export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// *word* → highlighted span; \n → <br> (highlighted words never break apart across lines)
export const rich = (s = "") =>
  esc(s)
    .replace(/\*([\s\S]+?)\*/g, (_, words) => `<span class="hl">${words.replace(/ /g, "&nbsp;")}</span>`)
    .replace(/\n/g, "<br>")


export const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=block" rel="stylesheet">`

export function resetDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true })
  mkdirSync(dir, { recursive: true })
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

// ---------- Headless Chrome ----------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean)

/** Opens one browser for many screenshots. render(html, file, {width, height, transparent}) → file. */
export async function openRenderer() {
  const puppeteer = require("puppeteer-core")
  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!executablePath) throw new Error("Chrome/Edge não encontrado. Defina CHROME_PATH.")
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--allow-file-access-from-files", "--hide-scrollbars"] })
  const page = await browser.newPage()
  return {
    async render(html, file, { width = 1080, height = 1920, transparent = false } = {}) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      // Loaded from a file (not setContent) so the page may read local photos.
      const htmlFile = file.replace(/\.png$/, ".html")
      writeFileSync(htmlFile, html)
      await page.goto(fileUrl(htmlFile), { waitUntil: "networkidle0", timeout: 30000 })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: file, omitBackground: transparent, type: "png" })
      return file
    },
    close: () => browser.close(),
  }
}

// ---------- ffmpeg ----------

export function ffmpeg(args) {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    throw new Error(`ffmpeg falhou: ${String(e.stderr || e.message).slice(-1500)}`)
  }
}

/** Duration in seconds of an audio/video file. */
export function mediaDuration(file) {
  let out = ""
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] })
  } catch (e) {
    out = String(e.stderr || "")
  }
  const m = out.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) throw new Error(`Não foi possível ler a duração de ${file}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

// ---------- Narration (Microsoft neural voices through Edge's read-aloud service) ----------

// ---------- Local narration (Kokoro + Whisper, no internet) ----------
// Used first when the local voice tools exist (default E:/Ferramentas/voz, override with CEE_VOZ_DIR). The word
// timings come from Whisper listening to the finished audio. Set CEE_VOZ=edge to force the Microsoft voice.
const VOZ_DIR = process.env.CEE_VOZ_DIR || "E:/Ferramentas/voz"
const VOZ_PY = path.join(VOZ_DIR, "venv/Scripts/python.exe")
const LOCAL_VOICE = process.env.CEE_VOZ_VOICE || "pf_dora"
let localServer = null

function startLocalServer() {
  if (localServer) return localServer
  const child = spawn(VOZ_PY, [path.join(VOZ_DIR, "servidor.py")], { cwd: VOZ_DIR, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  const state = { child, buf: "", waiting: [], ready: null }
  state.ready = new Promise((resolve, reject) => state.waiting.push({ resolve, reject }))
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d) => {
    state.buf += d
    let i
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim()
      state.buf = state.buf.slice(i + 1)
      if (!line) continue
      const w = state.waiting.shift()
      if (!w) continue
      try { w.resolve(JSON.parse(line)) } catch (e) { w.reject(e) }
    }
  })
  child.stderr.on("data", () => {})
  child.on("exit", () => {
    for (const w of state.waiting.splice(0)) w.reject(new Error("servidor de voz encerrou"))
    localServer = null
  })
  // The server must not keep Node alive on its own; requests re-reference it while waiting for an answer.
  child.unref()
  child.stdin.unref?.()
  child.stdout.unref?.()
  child.stderr.unref?.()
  localServer = state
  return state
}

export function closeNarrator() {
  if (!localServer) return
  try { localServer.child.stdin.end(); localServer.child.kill() } catch {}
  localServer = null
}
process.on("exit", closeNarrator)

async function narrateLocal(text, dir, name, { rate = "+6%" } = {}) {
  const state = startLocalServer()
  const hold = (on) => { for (const s of [state.child.stdout, state.child.stdin]) on ? s.ref?.() : s.unref?.() }
  hold(true)
  try {
    await state.ready
    const out = path.join(dir, `${name}.wav`).replace(/\\/g, "/")
    const speed = 1 + (parseFloat(String(rate).replace("%", "")) || 0) / 100
    const reply = await new Promise((resolve, reject) => {
      state.waiting.push({ resolve, reject })
      state.child.stdin.write(JSON.stringify({ text, out, voice: LOCAL_VOICE, speed }) + "\n")
    })
    if (!reply.ok) throw new Error(reply.error || "falha na voz local")
    return { file: out, duration: mediaDuration(out), words: reply.words }
  } finally {
    hold(false)
  }
}

export const DEFAULT_VOICE = "pt-BR-FranciscaNeural"

/**
 * Synthesizes `text` into <dir>/<name>.mp3 and returns { file, duration, words: [{ text, start, end }] }.
 * Word timings come from the TTS word boundaries and drive the burned-in captions.
 */
export async function narrate(text, dir, name, { voice = DEFAULT_VOICE, rate = "+6%" } = {}) {
  if (process.env.CEE_VOZ !== "edge" && existsSync(VOZ_PY)) {
    try {
      return await narrateLocal(text, dir, name, { rate })
    } catch (e) {
      console.warn("Voz local falhou, tentando a da Microsoft:", e.message)
    }
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts")
  const tmp = path.join(dir, `.tts-${name}`)
  resetDir(tmp)
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tts = new MsEdgeTTS()
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true })
      const { audioFilePath, metadataFilePath } = await tts.toFile(tmp, text, { rate })
      const file = path.join(dir, `${name}.mp3`)
      writeFileSync(file, readFileSync(audioFilePath))
      const words = []
      if (metadataFilePath && existsSync(metadataFilePath)) {
        for (const chunk of parseMetadata(readFileSync(metadataFilePath, "utf8"))) {
          for (const m of chunk.Metadata || []) {
            if (m.Type !== "WordBoundary") continue
            const start = m.Data.Offset / 1e7
            words.push({ text: m.Data.text.Text, start, end: start + m.Data.Duration / 1e7 })
          }
        }
      }
      rmSync(tmp, { recursive: true, force: true })
      return { file, duration: mediaDuration(file), words }
    } catch (e) {
      lastError = e
    } finally {
      try { tts.close() } catch {}
    }
  }
  throw new Error(`Falha na narração: ${lastError?.message}`)
}

// The metadata file is either a JSON array or concatenated JSON objects.
function parseMetadata(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return trimmed
      .replace(/}\s*{/g, "}\n{")
      .split("\n")
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  }
}

// ---------- Agent API (same key as carrossel/kit/publish.mjs) ----------

export function readEnv() {
  const env = {}
  const file = path.join(ROOT, ".env.local")
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  }
  return { ...env, ...process.env }
}

export function agentApi() {
  const env = readEnv()
  const base = (env.AGENT_BASE_URL || "https://cee-automacao.vercel.app").replace(/\/$/, "")
  const key = env.AUTOMATION_API_KEY
  if (!key) throw new Error("AUTOMATION_API_KEY não encontrada no .env.local")
  return async function api(route, init = {}) {
    const res = await fetch(`${base}/api/agent/${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${route}: ${json.error || `HTTP ${res.status}`}`)
    return json
  }
}
