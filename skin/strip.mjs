// Lay out sampled frames of a built clip in one row, for eyeballing motion.
//   node skin/strip.mjs <clip> [samples]
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const clip = process.argv[2] ?? 'idle'
const samples = Number(process.argv[3] ?? 6)
const dir = join(HERE, 'frames', clip)
const files = readdirSync(dir).filter(f => f.endsWith('.webp')).sort()
const picked = Array.from({ length: samples }, (_, i) => files[Math.round(i * (files.length - 1) / (samples - 1))])
const { width, height } = await sharp(join(dir, files[0])).metadata()
const k = 220 / width
const w = Math.round(width * k), h = Math.round(height * k)
const bg = { r: 248, g: 246, b: 243, alpha: 1 }
const parts = []
for (let i = 0; i < picked.length; i++) {
  parts.push({ input: await sharp(join(dir, picked[i])).flatten({ background: bg }).resize(w, h).ensureAlpha().png().toBuffer(), left: i * w, top: 0 })
}
const out = `/tmp/strip-${clip}.png`
await sharp({ create: { width: w * picked.length, height: h, channels: 4, background: bg } })
  .composite(parts).png().toFile(out)
console.log(out, `${picked.length} of ${files.length} frames`)
