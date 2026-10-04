// Contact sheet of a built carousel: node carrossel/kit/preview.mjs <dir>  →  <dir>/preview.jpg
import { readdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const sharp = require("sharp")

const dir = path.resolve(process.argv[2] || ".")
const files = readdirSync(path.join(dir, "out"))
  .filter((f) => /^slide-\d+\.jpg$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))

const cols = Math.min(files.length, files.length > 4 ? 3 : files.length)
const rows = Math.ceil(files.length / cols)
const w = 360, h = 450, gap = 12
const tiles = await Promise.all(
  files.map(async (f, i) => ({
    input: await sharp(path.join(dir, "out", f)).resize(w, h).toBuffer(),
    left: (i % cols) * (w + gap),
    top: Math.floor(i / cols) * (h + gap),
  })),
)
await sharp({ create: { width: cols * w + (cols - 1) * gap, height: rows * h + (rows - 1) * gap, channels: 3, background: "#ffffff" } })
  .composite(tiles)
  .jpeg({ quality: 88 })
  .toFile(path.join(dir, "preview.jpg"))
console.log(path.join(dir, "preview.jpg"))
