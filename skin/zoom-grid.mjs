// Gridded zoom of a region of the master, for placing cut lines by eye.
// Coordinates and grid labels are logical units; the crop is taken at the master's own size.
//   node skin/zoom-grid.mjs <x> <y> <w> <h> [step]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { SS, LOGICAL_WIDTH } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [lx, ly, lw, lh] = process.argv.slice(2, 6).map(Number)
const step = Number(process.argv[6] ?? 10)
const { width } = await sharp(join(HERE, 'poses', 'idle.png')).metadata()
const S = width / LOGICAL_WIDTH
const [x, y, w, h] = [Math.round(lx * S), Math.round(ly * S), Math.round(lw * S), Math.round(lh * S)]
const crop = await sharp(join(HERE, 'poses', 'idle.png')).flatten({ background: '#f2f2f2' })
  .extract({ left: x, top: y, width: w, height: h }).toBuffer()

const lines = []
for (let i = lx - (lx % step); i <= lx + lw; i += step) {
  const sx = (i - lx) * S
  lines.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${h}" stroke="${i % 50 === 0 ? '#e0342a' : '#00000040'}" stroke-width="${i % 50 === 0 ? 2 : 1}"/>`)
  if (i % 50 === 0) lines.push(`<text x="${sx + 3}" y="20" font-size="18" fill="#e0342a" font-family="monospace">${i}</text>`)
}
for (let j = ly - (ly % step); j <= ly + lh; j += step) {
  const sy = (j - ly) * S
  lines.push(`<line x1="0" y1="${sy}" x2="${w}" y2="${sy}" stroke="${j % 50 === 0 ? '#1a5fe0' : '#00000040'}" stroke-width="${j % 50 === 0 ? 2 : 1}"/>`)
  if (j % 50 === 0) lines.push(`<text x="3" y="${sy + 20}" font-size="18" fill="#1a5fe0" font-family="monospace">${j}</text>`)
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.join('')}</svg>`
const out = `/tmp/zoom-${lx}-${ly}.png`
await sharp(crop).composite([{ input: Buffer.from(svg) }])
  .resize({ width: Math.min(1100, lw * 4) }).png().toFile(out)
console.log(out)
