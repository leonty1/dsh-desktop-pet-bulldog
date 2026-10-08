// Walk outward across the figure's edge and print the colors, to see where the drawn line
// ends and the background band begins. Rows/columns are in the raw art's own pixels.
//   node skin/edge-profile.mjs <png> <x> <y> [dx] [dy] [steps]
import { sharp } from './sharp.mjs'
const [file, x0, y0, dx = -1, dy = 0, steps = 14] = process.argv.slice(2)
const { data: d, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, C = info.channels
let x = Number(x0), y = Number(y0)
for (let i = 0; i < Number(steps); i++) {
  const p = (y * W + x) * C
  const r = d[p], g = d[p + 1], b = d[p + 2]
  const lum = 0.3 * r + 0.59 * g + 0.11 * b
  const sat = Math.max(r, g, b) - Math.min(r, g, b)
  console.log(`  ${String(x).padStart(4)},${String(y).padStart(4)}  rgb(${r},${g},${b})  lum ${lum.toFixed(0).padStart(3)}  sat ${sat}`)
  x += Number(dx); y += Number(dy)
}
