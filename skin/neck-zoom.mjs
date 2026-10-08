// Zoomed strip of the neck junction across frames, for reading the outer outline.
// The crop is given in logical units and applied at whatever size the frames are.
//   node skin/neck-zoom.mjs [x y w h zoom] <clip:frame> [...]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = process.argv.slice(2)
const crop = arg.length > 4 && arg[0].includes(':') === false ? arg.splice(0, 5).map(Number) : [108, 176, 68, 72, 8]
const [LX, LY, LW, LH, ZOOM] = crop
const jobs = arg.map(a => a.split(':'))
if (jobs.length === 0) jobs.push(['idle', '001'], ['wave', '022'], ['thinking', '022'], ['waiting', '030'])

const tiles = []
for (const [clip, idx] of jobs) {
  const file = join(HERE, 'frames', clip, `${clip}_${idx}.webp`)
  const { width } = await sharp(file).metadata()
  const s = width / 412
  tiles.push(await sharp(file).flatten({ background: '#ffffff' })
    .extract({ left: Math.round(LX * s), top: Math.round(LY * s), width: Math.round(LW * s), height: Math.round(LH * s) })
    .resize({ width: LW * ZOOM, height: LH * ZOOM, kernel: sharp.kernel.nearest }).toBuffer())
}
const tw = LW * ZOOM, gap = 10
await sharp({ create: { width: tiles.length * (tw + gap) - gap, height: LH * ZOOM, channels: 3, background: '#ffffff' } })
  .composite(tiles.map((input, i) => ({ input, left: i * (tw + gap), top: 0 })))
  .jpeg({ quality: 92 })
  .toFile('/tmp/neck-junction.jpg')
console.log(`/tmp/neck-junction.jpg  ${jobs.map(j => j.join(':')).join(' ')}`)
