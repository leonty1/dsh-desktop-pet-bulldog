// Overlay a frame's silhouette edge on the master's, to see where the outline moves.
// Both are traced at their own pixel size and reported in logical units.
//   node skin/outline-check.mjs <clip:frame> [...]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { LOGICAL_WIDTH, LOGICAL_HEIGHT } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TILE = 420

/** @param path - image file. @returns its silhouette at its own pixel size. */
async function sil(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const m = new Uint8Array(info.width * info.height)
  for (let i = 0; i < m.length; i++) m[i] = data[i * info.channels + 3] > 128 ? 1 : 0
  return { m, w: info.width, h: info.height }
}
/** @param s - silhouette. @returns SVG squares tracing its boundary, at that silhouette's size. */
function edge(s, color, opacity) {
  const { m, w, h } = s
  const px = []
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    if (m[i] && (m[i - 1] !== m[i] || m[i + 1] !== m[i] || m[i - w] !== m[i] || m[i + w] !== m[i])) {
      px.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
    }
  }
  return `<g fill="${color}" opacity="${opacity}">${px.join('')}</g>`
}

const jobs = process.argv.slice(2).map(a => a.split(':'))
if (jobs.length === 0) jobs.push(['wave', '020'], ['look_right', '012'], ['idle', '001'])
const master = await sil(join(HERE, 'poses', 'idle.png'))
const parts = []
for (const [clip, n] of jobs) {
  const file = join(HERE, 'frames', clip, `${clip}_${n}.webp`)
  const frame = await sil(file)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.w}" height="${frame.h}">`
    + edge(master, '#00e0ff', 0.5) + edge(frame, '#ff2d55', 1) + '</svg>'
  parts.push({
    input: await sharp(file).composite([{ input: Buffer.from(svg) }])
      .resize({ width: TILE, height: Math.round(TILE * LOGICAL_HEIGHT / LOGICAL_WIDTH) })
      .flatten({ background: '#1d2733' }).toBuffer(),
  })
}
const th = Math.round(TILE * LOGICAL_HEIGHT / LOGICAL_WIDTH)
const cols = Math.min(3, parts.length), rows = Math.ceil(parts.length / cols)
const out = '/tmp/outline-check.jpg'
await sharp({ create: { width: TILE * cols, height: th * rows, channels: 3, background: { r: 29, g: 39, b: 51 } } })
  .composite(parts.map((p, i) => ({ input: p.input, left: (i % cols) * TILE, top: Math.floor(i / cols) * th })))
  .jpeg({ quality: 92 }).toFile(out)
console.log(out, 'cyan = master outline, red = this frame')
