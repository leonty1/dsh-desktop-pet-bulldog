// How clean each master's silhouette edge is: the ring of partially transparent pixels
// around the figure, and how even the drawn line's outer boundary runs.
//   node skin/edge-quality.mjs [poses-dir]
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharp } from './sharp.mjs'

const DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'poses')

/** @param png - a master. @returns its edge statistics in device pixels. */
async function quality(png) {
  const { data: d, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const a = (x, y) => d[(y * W + x) * C + 3]
  const lum = (x, y) => 0.3 * d[(y * W + x) * C] + 0.59 * d[(y * W + x) * C + 1] + 0.11 * d[(y * W + x) * C + 2]
  const solid = (x, y) => a(x, y) >= 200
  let soft = 0, dark = 0, rim = 0, area = 0, perimeter = 0
  const widths = []
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!solid(x, y)) continue
    area++
    const edge = !(solid(x - 1, y)) || !(solid(x + 1, y)) || !(solid(x, y - 1)) || !(solid(x, y + 1))
    if (!edge) continue
    perimeter++
    // How far the drawn line reaches inward from this rim pixel, walking the row.
    let w = 0
    while (w < 20 && solid(x + w, y) && lum(x + w, y) < 165) w++
    if (w > 0) widths.push(w)
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const al = a(x, y)
    if (al === 0 || al >= 200) continue
    soft++
    if (lum(x, y) < 170) dark++
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) rim++
  }
  widths.sort((p, q) => p - q)
  const q = (f) => widths[Math.floor(widths.length * f)] ?? 0
  return {
    area, perimeter, soft, darkSoft: dark, rimSoft: rim,
    lineMedian: q(0.5), lineP10: q(0.1), lineP90: q(0.9),
    lineSpread: (q(0.9) - q(0.1)) / Math.max(1, q(0.5)),
  }
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()) {
  const r = await quality(join(DIR, file))
  console.log(`${file.replace('.png', '').padEnd(8)} solid ${String(r.area).padStart(6)}  edge ${String(r.perimeter).padStart(5)}  ` +
    `半透明 ${String(r.soft).padStart(4)}（其中暗色 ${r.darkSoft}）  线宽中位 ${r.lineMedian} p10 ${r.lineP10} p90 ${r.lineP90}  不均匀度 ${r.lineSpread.toFixed(2)}`)
}
