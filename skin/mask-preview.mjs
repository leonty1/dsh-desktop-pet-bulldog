// Overlay each bone's claimed pixels on the master, to check the cut.
//   node skin/mask-preview.mjs [boneId ...]
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { WIDTH, HEIGHT, BONES, rigContext } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const { data, info } = await sharp(join(HERE, 'poses', 'idle.png')).ensureAlpha()
  .raw().toBuffer({ resolveWithObject: true })
const g = rigContext(data, info.channels)
const palette = [[224, 52, 42], [26, 95, 224], [18, 161, 80], [240, 160, 20], [150, 40, 200], [20, 170, 190]]
const picked = BONES.filter(b => process.argv.length <= 2 || process.argv.slice(2).includes(b.id))
const rgba = Buffer.alloc(WIDTH * HEIGHT * 4)
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
  const q = y * WIDTH + x
  const p = q * 4
  if (g.sil[q] === 0) { rgba[p] = 242; rgba[p + 1] = 242; rgba[p + 2] = 242; rgba[p + 3] = 255; continue }
  const src = (y * info.width + x) * info.channels
  rgba[p] = data[src]; rgba[p + 1] = data[src + 1]; rgba[p + 2] = data[src + 2]; rgba[p + 3] = 255
}
const acc = Uint8ClampedArray.from(rgba)
picked.forEach((bone, i) => {
  const m = bone.region(g)
  const [r, gg, b] = palette[i % palette.length]
  for (let q = 0; q < WIDTH * HEIGHT; q++) {
    if (m[q] === 0) continue
    const p = q * 4
    acc[p] = Math.round(acc[p] * 0.35 + r * 0.65)
    acc[p + 1] = Math.round(acc[p + 1] * 0.35 + gg * 0.65)
    acc[p + 2] = Math.round(acc[p + 2] * 0.35 + b * 0.65)
  }
})
const out = '/tmp/mask-preview.png'
await sharp(Buffer.from(acc.buffer, acc.byteOffset, acc.byteLength), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
  .resize({ width: 824 }).png().toFile(out)
console.log(out, picked.map(b => b.id).join(' '))
