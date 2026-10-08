// Count the silhouette's rim pixels that carry no outline, per clip. The line is drawn by
// hand on each master and the rig repaints a band of the body, so both can leave a stretch
// of bare coat at the edge; that reads as the outline breaking into segments.
//   node skin/outline-scan.mjs [frames-root] [manifest]
//   node skin/outline-scan.mjs --mark <clip:frame>   # show one frame's gaps
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARK = process.argv.indexOf('--mark')
const [clip, num] = MARK > 0 ? process.argv[MARK + 1].split(':') : []
const ROOT = MARK > 0 ? join(HERE, 'frames') : process.argv[2] ?? join(HERE, 'frames')
const MANIFEST = MARK > 0 ? join(HERE, 'pet-manifest.json') : process.argv[3] ?? join(HERE, 'pet-manifest.json')
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
/** How far the drawn line reaches in from the edge, and how dark it has to be, in device px. */
const REACH = 7, DARK = 165

/** @param rel - one frame path. @returns its pixels, and which of them sit on an unlined rim. */
async function gaps(rel) {
  const { data: d, info } = await sharp(join(ROOT, rel)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const op = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * C + 3] > 40
  const lum = (x, y) => 0.3 * d[(y * W + x) * C] + 0.59 * d[(y * W + x) * C + 1] + 0.11 * d[(y * W + x) * C + 2]
  const bare = []
  let rim = 0
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!op(x, y)) continue
    if (op(x - 2, y) && op(x + 2, y) && op(x, y - 2) && op(x, y + 2)) continue
    rim++
    let lined = lum(x, y) < DARK
    for (let dy = -REACH; dy <= REACH && !lined; dy++) for (let dx = -REACH; dx <= REACH && !lined; dx++) {
      if (dx * dx + dy * dy > REACH * REACH || !op(x + dx, y + dy)) continue
      if (lum(x + dx, y + dy) < DARK) lined = true
    }
    if (!lined) bare.push([x, y])
  }
  return { W, H, C, data: d, rim, bare }
}

if (MARK > 0) {
  const rel = manifest.clips[clip].frames[Number(num) - 1]
  const { W, H, bare } = await gaps(rel)
  const mark = Buffer.alloc(W * H * 4)
  for (const [x, y] of bare) for (let my = -3; my <= 3; my++) for (let mx = -3; mx <= 3; mx++) {
    const o = ((y + my) * W + (x + mx)) * 4
    mark[o] = 255; mark[o + 2] = 0; mark[o + 1] = 0; mark[o + 3] = 220
  }
  const flat = await sharp(join(ROOT, rel)).flatten({ background: '#ffffff' }).toBuffer()
  await sharp(flat).composite([{ input: await sharp(mark, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(), blend: 'over' }])
    .resize({ width: Math.round(W * 1.6), height: Math.round(H * 1.6), kernel: sharp.kernel.nearest }).toFile('/tmp/outline-bare.png')
  const xs = bare.map((b) => b[0]), ys = bare.map((b) => b[1])
  console.log(`/tmp/outline-bare.png  ${rel}  ${bare.length} bare rim px`)
  if (bare.length) console.log(`  x ${Math.min(...xs) / 2}..${Math.max(...xs) / 2}  y ${Math.min(...ys) / 2}..${Math.max(...ys) / 2} (logical)`)
  process.exit(0)
}

/** @param clip - a clip name. @returns its rim pixels with no line within REACH of them. */
async function scan(clip) {
  let bare = 0, rim = 0, worst = { at: 0, frame: '' }
  for (const rel of manifest.clips[clip].frames) {
    const g = await gaps(rel)
    rim += g.rim
    bare += g.bare.length
    if (g.bare.length > worst.at) worst = { at: g.bare.length, frame: rel.split('/').pop() }
  }
  return { clip, bare, rim, worst }
}

const out = []
for (const clip of Object.keys(manifest.clips)) out.push(await scan(clip))
out.sort((a, b) => b.bare - a.bare)
console.log(`rim without an outline, within ${REACH} device px of the edge: ${ROOT}`)
for (const r of out.filter((x) => x.bare > 0)) {
  console.log(`  ${r.clip.padEnd(17)} ${String(r.bare).padStart(6)} of ${r.rim}   worst frame ${r.worst.frame} (${r.worst.at})`)
}
const clean = out.filter((x) => x.bare === 0).map((x) => x.clip)
console.log(`  clean: ${clean.length} of ${out.length} clips (${clean.join(', ')})`)
console.log(`  TOTAL ${out.reduce((s, r) => s + r.bare, 0)} bare of ${out.reduce((s, r) => s + r.rim, 0)} rim pixels`)
