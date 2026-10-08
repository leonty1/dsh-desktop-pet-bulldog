// Per-row silhouette geometry of the master, in logical units: outline columns, width,
// and the share of the row that is outline ink or pale blaze. Use it to place a seam.
//   node skin/rows.mjs [y0] [y1]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LOGICAL_WIDTH } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [y0, y1] = process.argv.slice(2).map(Number)
const { data: px, info } = await sharp(join(HERE, 'poses', 'idle.png')).raw().toBuffer({ resolveWithObject: true })
const { width: W, channels: ch } = info
const S = W / LOGICAL_WIDTH
for (let ly = y0 ?? 190; ly <= (y1 ?? 250); ly++) {
  const y = Math.round((ly + 0.5) * S)
  let l = -1, r = -1, dark = 0, pale = 0, tot = 0
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * ch
    if (px[i + 3] <= 8) continue
    if (l < 0) l = x
    r = x; tot++
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
    if (lum < 120) dark++
    if (lum > 225) pale++
  }
  if (tot === 0) { console.log(`y=${ly} empty`); continue }
  console.log(`y=${ly}  x=${(l / S).toFixed(1)}..${(r / S).toFixed(1)}  w=${((r - l + 1) / S).toFixed(1)}  dark%=${(100 * dark / tot).toFixed(1)}  pale%=${(100 * pale / tot).toFixed(1)}`)
}
