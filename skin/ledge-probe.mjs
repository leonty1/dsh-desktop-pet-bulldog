import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharp } from './sharp.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const { LOGICAL_WIDTH, LOGICAL_HEIGHT } = await import(join(HERE, 'rig.mjs'))

/** @param file - image path. @returns its per-row logical outline columns. */
async function rows(file) {
  const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: dw, height: dh, channels: ch } = info
  const sx = dw / LOGICAL_WIDTH, sy = dh / LOGICAL_HEIGHT
  const out = []
  for (let ly = 0; ly < LOGICAL_HEIGHT; ly++) {
    const y = Math.min(dh - 1, Math.round((ly + 0.5) * sy))
    let l = -1, r = -1
    for (let dx = 0; dx < dw; dx++) if (px[(y * dw + dx) * ch + 3] > 8) { if (l < 0) l = dx; r = dx }
    out.push(l < 0 ? [-1, -1] : [l / sx, r / sx])
  }
  return out
}

const master = await rows(join(HERE, 'poses', 'idle.png'))

/** The neck seam shows as a jump in the frame's outline offset from the master's, per side. */
function ledge(f, y0, y1) {
  let big = 0, at = 0
  for (let y = y0 + 1; y <= y1; y++) {
    for (const side of [0, 1]) {
      const d0 = f[y - 1][side] - master[y - 1][side]
      const d1 = f[y][side] - master[y][side]
      if (Math.abs(d1 - d0) > big) { big = Math.abs(d1 - d0); at = y }
    }
  }
  return `${big.toFixed(1)}px@${at}`
}

for (const spec of process.argv.slice(2)) {
  const [dir, clip, frame] = (() => {
    const parts = spec.split('/')
    const frame = parts.at(-1), clip = parts.at(-2)
    return [parts.slice(0, -2).join('/'), clip, frame]
  })()
  const file = join(dir, clip, `${clip}_${frame}.webp`)
  if (!existsSync(file)) continue
  const f = await rows(file)
  console.log(`${dir.includes('assets') ? 'old' : 'new'}  ${clip}:${frame}  neck ledge ${ledge(f, 168, 215)}`)
}
