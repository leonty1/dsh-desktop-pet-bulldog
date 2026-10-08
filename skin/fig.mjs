// Full-figure review: master and rendered frames side by side at a chosen display size.
//   node skin/fig.mjs <size> <clip:frame> [...]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const size = Number(process.argv[2] ?? 160)
const jobs = process.argv.slice(3).map(a => a.split(':'))
if (jobs.length === 0) jobs.push(['idle', '001'], ['idle', '012'], ['thinking', '022'], ['waiting', '030'])

const tiles = []
for (const [clip, idx] of jobs) {
  const f = join(HERE, 'frames', clip, `${clip}_${idx}.webp`)
  tiles.push(await sharp(f).flatten({ background: '#e9e9ee' }).resize({ width: size }).toBuffer())
}
const m = await sharp(tiles[0]).metadata()
const gap = 8
await sharp({ create: { width: tiles.length * (m.width + gap) - gap, height: m.height, channels: 3, background: '#e9e9ee' } })
  .composite(tiles.map((input, i) => ({ input, left: i * (m.width + gap), top: 0 })))
  .jpeg({ quality: 92 })
  .toFile('/tmp/fig.jpg')
console.log(`/tmp/fig.jpg  ${jobs.map(j => j.join(':')).join(' ')}  @${size}px`)
