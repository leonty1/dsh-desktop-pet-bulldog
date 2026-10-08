// Per-row silhouette of a rendered frame next to the master's, in logical units,
// to locate outline steps. Coordinates are logical; the images are read at their own size.
//   node skin/rowdiff.mjs <clip:frame> [y0] [y1]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const [clip, idx] = (process.argv[2] ?? 'idle:001').split(':')
const y0 = Number(process.argv[3] ?? 180), y1 = Number(process.argv[4] ?? 260)

/** @param file - image path. @returns its per-row logical outline columns. */
async function rows(file) {
  const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: dw, height: dh, channels: ch } = info
  const sx = dw / LOGICAL_WIDTH, sy = dh / LOGICAL_HEIGHT
  const out = []
  for (let ly = 0; ly < LOGICAL_HEIGHT; ly++) {
    const y = Math.min(dh - 1, Math.round((ly + 0.5) * sy))
    let l = -1, r = -1
    for (let dx = 0; dx < dw; dx++) {
      if (px[(y * dw + dx) * ch + 3] > 8) { if (l < 0) l = dx; r = dx }
    }
    out.push(l < 0 ? [-1, -1] : [l / sx, r / sx])
  }
  return out
}

const m = await rows(join(HERE, 'poses', 'idle.png'))
const f = await rows(join(HERE, 'frames', clip, `${clip}_${idx}.webp`))
console.log(`${clip}:${idx}   row  master(l..r)  frame(l..r)  dl dr`)
for (let y = y0; y <= y1; y++) {
  const [ml, mr] = m[y], [fl, fr] = f[y]
  if (Math.round(fl) === Math.round(ml) && Math.round(fr) === Math.round(mr)) continue
  console.log(`y=${y}  ${ml.toFixed(1)}..${mr.toFixed(1)}  ${fl.toFixed(1)}..${fr.toFixed(1)}  ${fl - ml >= 0 ? '+' : ''}${(fl - ml).toFixed(1)} ${fr - mr >= 0 ? '+' : ''}${(fr - mr).toFixed(1)}`)
}
