// Draw the rig's cut lines and joints over the master, for placing them against the art.
//   node skin/cut-preview.mjs
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { SS, WIDTH, HEIGHT, BONES, PAW, chinLine, headBelow } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const line = (pts, color, width = 1.6) => `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`
const dot = (p, color, label) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/><text x="${p[0] + 7}" y="${p[1] - 6}" font-size="12" fill="${color}" font-family="monospace">${label}</text>`

// The seam and the paw polygon are authored in logical units; the master is SS of those.
const neck = [], bodyTop = []
for (let x = 108; x <= 304; x += 2) {
  neck.push([(x * SS).toFixed(1), (chinLine(x) * SS).toFixed(1)])
  bodyTop.push([(x * SS).toFixed(1), ((headBelow(x) - 6) * SS).toFixed(1)])
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  ${line(bodyTop, '#e0a300', 1.2)}
  ${line(neck, '#1a5fe0')}
  ${line(PAW.map(p => [p[0] * SS, p[1] * SS]).concat([[PAW[0][0] * SS, PAW[0][1] * SS]]), '#12a150')}
  ${BONES.map(b => dot(b.pivot, '#e0342a', b.id)).join('')}
</svg>`

const out = '/tmp/cut-preview.png'
await sharp(join(HERE, 'poses', 'idle.png')).flatten({ background: '#f2f2f2' })
  .composite([{ input: Buffer.from(svg) }]).resize({ width: 824 }).png().toFile(out)
console.log(out)
