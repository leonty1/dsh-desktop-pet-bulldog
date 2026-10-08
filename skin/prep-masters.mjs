// Turn a raw AI image of the dog into the clean, normalized pose masters.
//
//   node skin/prep-masters.mjs
//
// Reads vibe_images/frnt-<pose>_<ts>.png (raw AI art on a solid background) and
// writes skin/poses/<pose>.png: background keyed to transparent,
// the baked-in watermark cropped and dropped, the dog trimmed, scaled to its pose's
// own size, and bottom-centered on the frame the sprite clips use. That frame is SS
// times the clip's logical 412x344, because the helper draws a clip into a window of
// its logical size and a Retina display asks that window for twice as many device
// pixels; the raw art carries them.
//
// Each pose is sized by the extent that carries it: the sitting dog by its height, the
// lying one by its width, since lying down trades height for width. Every pose still
// lands on the same baseline, so switching states does not slide the dog across the
// desktop. Raw AI files are scratch and not committed; the masters are.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { SS } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const POSE_DIR = join(HERE, 'poses')
const RAW_DIR = join(process.cwd(), 'vibe_images')
const WIDTH = 412 * SS
const HEIGHT = 344 * SS
const BASELINE = 332 * SS
/** How many master pixels of edge take their color from the art inside them. */
const RIM = 3 * SS
/** How much of the palette gap a pose closes against the pose it borrows its colors from. */
const PALETTE_STRENGTH = 0.85
/** @param pose - clip pose name. @returns how big that pose is drawn and on which axis. */
const POSES = [
  { name: 'idle', fit: { height: 300 * SS } },
  { name: 'lying', fit: { width: 296 * SS }, palette: 'idle' },
  { name: 'back', fit: { height: 300 * SS }, palette: 'idle' },
]

/** Per-channel mean and spread over an image's opaque pixels.
 * @param png - encoded image.
 * @returns The first two moments of each color channel.
 */
async function moments(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const sum = [0, 0, 0], sq = [0, 0, 0]
  let n = 0
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue
    n++
    for (let c = 0; c < 3; c++) { sum[c] += data[i + c]; sq[c] += data[i + c] * data[i + c] }
  }
  return { mean: sum.map((s) => s / n), std: sq.map((s, c) => Math.sqrt(Math.max(0, s / n - (sum[c] / n) ** 2))) }
}

/** How far inside the silhouette the drawn outline reaches, in device pixels. */
const STROKE_DEPTH = 12

/** @param png - encoded image.
 * @returns the master's pixels, the device distance of every opaque pixel from the
 * silhouette edge, and the luminance of its outline and its coat.
 */
async function measure(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: ch } = info
  const depth = new Int16Array(W * H).fill(-1)
  let frontier = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (data[i * ch + 3] >= 200) continue
    depth[i] = 0
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (depth[j] === -1 && data[j * ch + 3] >= 200) { depth[j] = 1; frontier.push(j) }
    }
  }
  for (let d = 1; d <= STROKE_DEPTH + 2 && frontier.length > 0; d++) {
    const next = []
    for (const i of frontier) {
      const x = i % W, y = (i - x) / W
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (depth[j] === -1 && data[j * ch + 3] >= 200) { depth[j] = d + 1; next.push(j) }
      }
    }
    frontier = next
  }
  const lum = (i) => 0.299 * data[i * ch] + 0.587 * data[i * ch + 1] + 0.114 * data[i * ch + 2]
  const edge = [], coat = []
  for (let i = 0; i < W * H; i++) {
    if (depth[i] < 0) continue
    if (depth[i] >= 1 && depth[i] <= 6) edge.push(lum(i))
    else if (depth[i] >= 14) coat.push(lum(i))
  }
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
  return { data, W, H, ch, depth, stroke: median(edge), coat: median(coat) }
}

/**
 * Draw the pose's outline from the reference master's own line.
 *
 * The sitting art is drawn with a thick dark line and reads as one closed curve. The lying
 * art arrives with a line that is thin, pale and uneven in weight, so darkening it cannot
 * make it match: what remains is a ragged scribble along the flank and the foot, and the
 * back art is the same complaint in reverse — it simply leaves stretches of its rim unlined.
 * Redrawing the rim is the one operation that fixes weight, color and continuity at once.
 *
 * The line is painted inward from the silhouette over the reference's own width, at the
 * reference's own color, and faded out over its last three pixels so it meets the coat
 * rather than stopping on it. The shape does not move: only pixels already inside the
 * silhouette are touched.
 *
 * @param png - the pose's keyed master, after its silhouette has been rounded.
 * @param source - the master whose line it takes.
 * @returns The redrawn master, with the reference's line width and color.
 */
async function restroke(png, source) {
  const [pose, ref] = await Promise.all([measure(png), measure(source)])
  const mid = (m) => (m.stroke + m.coat) / 2
  const lumOf = (data, ch, i) => 0.3 * data[i * ch] + 0.59 * data[i * ch + 1] + 0.11 * data[i * ch + 2]
  const widths = []
  let sr = 0, sg = 0, sb = 0, sn = 0
  for (let i = 0; i < ref.W * ref.H; i++) {
    if (ref.depth[i] < 1 || lumOf(ref.data, ref.ch, i) >= mid(ref)) continue
    widths.push(ref.depth[i])
    if (ref.depth[i] <= 3) { sr += ref.data[i * ref.ch]; sg += ref.data[i * ref.ch + 1]; sb += ref.data[i * ref.ch + 2]; sn++ }
  }
  if (sn === 0 || widths.length === 0) return { png, width: 0, color: null }
  widths.sort((p, q) => p - q)
  const width = Math.max(4, widths[Math.floor(widths.length * 0.6)])
  const line = [sr / sn, sg / sn, sb / sn]
  const { data, W, H, ch, depth } = pose
  for (let i = 0; i < W * H; i++) {
    const d = depth[i]
    if (d < 1 || d > width) continue
    const reach = Math.min(1, (width - d) / 3)
    const p = i * ch
    for (let c = 0; c < 3; c++) data[p + c] = Math.round(data[p + c] * (1 - reach) + line[c] * reach)
  }
  const out = await sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer()
  return { png: out, width, color: line.map((v) => Math.round(v)) }
}

/**
 * Round the silhouette's staircase.
 *
 * The matte is one bit per pixel, so every step the flood and the peel took along the
 * drawing's antialiased edge is left in the silhouette as a tooth. This is done after the
 * art is scaled to master size, because that is where the steps are the size the eye reads:
 * at the raw art's size they are two and three pixels, and the downscale carries them over
 * rather than averaging them away.
 *
 * A pixel survives when five of its nine neighborhood are inside. Where the filter opens a
 * notch it also closes one elsewhere, so a pixel that becomes part of the figure takes the
 * color of a neighbor that already had one; the outline that follows is painted over the
 * whole rim, so neither kind of seam is left to show.
 *
 * @param png - the pose's keyed master, before its line is redrawn.
 * @param passes - how many times to apply the filter.
 * @returns The master with a rounded silhouette.
 */
async function smoothEdge(png, passes = 2) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  const was = new Uint8Array(W * H)
  let mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) { was[i] = mask[i] = data[i * ch + 3] >= 128 ? 1 : 0 }
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        n += mask[ny * W + nx]
      }
      next[y * W + x] = n >= 5 ? 1 : 0
    }
    mask = next
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * ch
    if (!mask[i]) { data[p + 3] = 0; continue }
    data[p + 3] = 255
    if (was[i]) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !was[ny * W + nx]) continue
      const q = (ny * W + nx) * ch
      data[p] = data[q]; data[p + 1] = data[q + 1]; data[p + 2] = data[q + 2]
      dy = 2; dx = 2
    }
  }
  return { png: await sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer() }
}

/** Move one pose's palette onto the pose it names as its color source.
 *
 * A second generation of the same dog arrives with its own cast. Measured over opaque
 * pixels, the lying art came back golden where the sitting dog is pale fawn — mean
 * rgb(200,161,116) against rgb(216,185,151) — with no cream in the coat at all and an
 * outline near twice as dark, so the two states read as two animals. Matching each
 * channel's mean and spread is affine: it carries the cast over without touching the
 * drawing's own shading. A full histogram match was tried first and speckled the flat
 * fur, because the source's dither lands on the reference CDF's steep runs.
 *
 * @param png - the pose's finished master.
 * @param source - the master whose palette it takes.
 * @returns The recolored master and the means on both sides of the match.
 */
async function matchPalette(png, source) {
  const to = await moments(source)
  const from = await moments(png)
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 8) continue
    for (let c = 0; c < 3; c++) {
      const v = data[i + c]
      const mapped = to.mean[c] + (v - from.mean[c]) * (to.std[c] / from.std[c])
      // Clamp: the affine map sends the art's darkest ink below zero when the reference is
      // lighter than the pose, and a raw Buffer wraps -16 to 240, so the eyes came back blue.
      data[i + c] = Math.max(0, Math.min(255, Math.round(v + PALETTE_STRENGTH * (mapped - v))))
    }
  }
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer()
  return { png: out, before: from.mean.map(Math.round), after: (await moments(out)).mean.map(Math.round) }
}

/** @param pose - clip pose name. @returns the newest matching raw file name. */
function rawFor(pose) {
  return readdirSync(RAW_DIR).filter(f => f.startsWith(`frnt-${pose}_`)).sort().at(-1)
}

for (const { name: pose, fit, palette } of POSES) {
  const raw = rawFor(pose)
  if (raw === undefined) { console.error(`no raw for ${pose}`); process.exit(1) }
  const meta = await sharp(join(RAW_DIR, raw)).metadata()
  const { data, info } = await sharp(join(RAW_DIR, raw))
    .extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.91) })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info
  const at = (x, y) => { const p = (y * w + x) * c; return [data[p], data[p + 1], data[p + 2]] }
  const bg = at(2, 2)
  for (let i = 0; i < w * h; i++) {
    const p = i * c
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2)
    const a = Math.max(0, Math.min(1, (d - 28) / (95 - 28)))
    const t = 1 - a
    data[p] = Math.round(r - (r - bg[0]) * t * 0.7)
    data[p + 1] = Math.round(g - (g - bg[1]) * t * 0.7)
    data[p + 2] = Math.round(b - (b - bg[2]) * t * 0.7)
    data[p + 3] = Math.round(a * 255)
  }
  let buf = await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toBuffer()
  const r2 = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const a2 = r2.data, ch = r2.info.channels, W = r2.info.width, H = r2.info.height
  // The keyed alpha cannot be trusted inside the body: pale fur sits as close to the
  // background color as the background does. Flood the thin pixels from the border to
  // separate real background from interior, then make the interior solid.
  const outside = new Uint8Array(W * H)
  const stack = []
  // What the flood walks through is everything the drawing is not, and this art makes that
  // two comparisons. Every color in the dog is warm, so blue never reaches green, while the
  // magenta background is a mixture of magenta and white, where blue sits above green. The
  // keyed alpha alone cannot separate them — the sticker band is far from the background
  // color, and the coat's own pale blaze is as light as it is — but the drawing's outline is
  // a continuous warm wall, so the flood stops there and the interior highlights stay
  // unreachable. The band's innermost pixels have taken a little of the coat, so blue drops
  // below green there and the first test lets them stand as a white ring around the figure;
  // what gives them away is that they are still nearly colorless and nearly white, which no
  // part of the drawing is.
  const neutral = (p) => {
    const r = a2[p], g = a2[p + 1], b = a2[p + 2]
    return Math.max(r, g, b) - Math.min(r, g, b) < 26 && 0.299 * r + 0.587 * g + 0.114 * b > 232
  }
  const notArt = (p) => a2[p + 3] < 170 || a2[p + 2] >= a2[p + 1] || neutral(p)
  const push = (x, y) => {
    const i = y * W + x
    if (outside[i] !== 0 || !notArt(i * ch)) return
    outside[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
  while (stack.length > 0) {
    const i = stack.pop()
    const x = i % W, y = (i - x) / W
    if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1)
  }
  // No peel. The flood stops at the drawing's outline on its own, because the sticker band
  // is white and the outline is warm, and the comparison above already separates them. An
  // earlier round of this peeled whatever touched the background and was lighter than 180,
  // then 235 or desaturated, on the theory that the band's innermost pixels had taken a cast
  // of the coat. On the lying art that ate the outline itself: its line is thin and pale, so
  // its own antialiased edge answers both tests, and each round removed another row of it
  // until the silhouette boundary was the ragged inside of a half-eaten stroke. The line is
  // redrawn from the reference master afterward, which covers the band's cast instead of
  // cutting the drawing to hide it.
  for (let i = 0; i < W * H; i++) a2[i * ch + 3] = outside[i] === 1 ? 0 : 255
  // Keying cannot remove the background's color from the pixels it touched. The raw art
  // sits on a saturated magenta, and the ring of pixels the dog's outline fades into
  // carries that hue: measured on the keyed result, most of the silhouette's edge pixels
  // are redder than anything in the drawing. Solidity does not make them clean, so pull
  // the rim's color in from the art beside it and keep each pixel's own coverage.
  const rim = new Uint8Array(W * H)
  const queue = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (a2[i * ch + 3] === 0) continue
    let near = false
    for (let dy = -RIM; dy <= RIM && !near; dy++) for (let dx = -RIM; dx <= RIM && !near; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || a2[(ny * W + nx) * ch + 3] === 0) near = true
    }
    if (near) rim[i] = 1; else queue.push(i)
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % W, y = (i - x) / W, p = i * ch
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx, q = j * ch
      if (rim[j] !== 1 || a2[q + 3] === 0) continue
      rim[j] = 2
      a2[q] = a2[p]; a2[q + 1] = a2[p + 1]; a2[q + 2] = a2[p + 2]
      queue.push(j)
    }
  }
  buf = await sharp(a2, { raw: { width: W, height: H, channels: ch } }).png().toBuffer()
  const dog = await sharp(buf).trim().resize({ ...fit, fit: 'inside' }).png().toBuffer()
  const dm = await sharp(dog).metadata()
  const out = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: dog, left: Math.round((WIDTH - dm.width) / 2), top: Math.round(BASELINE - dm.height) }]).png().toBuffer()
  if (palette === undefined) {
    writeFileSync(join(POSE_DIR, `${pose}.png`), out)
    console.log(`${pose}: ${dm.width}x${dm.height}`)
    continue
  }
  const reference = readFileSync(join(POSE_DIR, `${palette}.png`))
  const matched = await matchPalette(out, reference)
  const lined = await restroke((await smoothEdge(matched.png)).png, reference)
  writeFileSync(join(POSE_DIR, `${pose}.png`), lined.png)
  console.log(`${pose}: ${dm.width}x${dm.height}, palette from ${palette} mean rgb(${matched.before}) -> rgb(${matched.after}), outline redrawn ${lined.width}px rgb(${lined.color})`)
}
console.log('masters ready')
