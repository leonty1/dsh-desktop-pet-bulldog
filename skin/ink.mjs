// Where the master's line work sits, in logical units: dark runs per row that are not
// part of the outer outline. Use it to keep a seam clear of ink.
//   node skin/ink.mjs [y0] [y1]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LOGICAL_WIDTH } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [y0, y1] = process.argv.slice(2).map(Number)
const { data: px, info } = await sharp(join(HERE, 'poses', 'idle.png')).raw().toBuffer({ resolveWithObject: true })
const { width: W, channels: ch } = info
const S = W / LOGICAL_WIDTH
const lum = (x, y) => { const i = (y * W + x) * ch; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] }
const alpha = (x, y) => px[(y * W + x) * ch + 3]
for (let ly = y0 ?? 170; ly <= (y1 ?? 240); ly++) {
  const y = Math.round((ly + 0.5) * S)
  let l = -1, r = -1
  for (let x = 0; x < W; x++) if (alpha(x, y) > 8) { if (l < 0) l = x; r = x }
  const runs = []
  let s = -1
  const inset = 5 * S
  for (let x = l + inset; x <= r - inset; x++) {
    if (lum(x, y) < 135 && s < 0) s = x
    if (lum(x, y) >= 135 && s >= 0) { runs.push(`${(s / S).toFixed(0)}..${(x / S).toFixed(0)}`); s = -1 }
  }
  if (s >= 0) runs.push(`${(s / S).toFixed(0)}..${((r - inset) / S).toFixed(0)}`)
  console.log(`y=${ly}  edge ${(l / S).toFixed(1)}..${(r / S).toFixed(1)}  ink: ${runs.join(' ')}`)
}
