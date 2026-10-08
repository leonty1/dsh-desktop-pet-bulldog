// Per-column bottom edge of the master, in logical units: the lowest silhouette row and
// the darkest row just above it, which is where the outline stroke sits. Use it to read
// an underside curve.
//   node skin/cols.mjs [x0] [x1]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LOGICAL_WIDTH } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [x0, x1] = process.argv.slice(2).map(Number)
const { data: px, info } = await sharp(join(HERE, 'poses', 'idle.png')).raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: ch } = info
const S = W / LOGICAL_WIDTH
const pxAt = (lx, ly) => { const i = (Math.round(ly * S) * W + Math.round(lx * S)) * ch; return { a: px[i + 3], l: 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] } }
for (let lx = x0 ?? 140; lx <= (x1 ?? 275); lx++) {
  let bot = -1
  for (let ly = H / S; ly >= 0; ly--) if (pxAt(lx, ly).a > 8) { bot = ly; break }
  let inkY = -1, inkL = 999
  for (let ly = Math.max(0, bot - 12); ly <= bot; ly++) { const p = pxAt(lx, ly); if (p.a > 40 && p.l < inkL) { inkL = p.l; inkY = ly } }
  console.log(`x=${lx}  bottom=${bot.toFixed(1)}  stroke@${inkY.toFixed(1)} lum=${inkL.toFixed(0)}`)
}
