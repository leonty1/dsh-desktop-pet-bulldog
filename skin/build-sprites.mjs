// Bone-rig sprite builder: one master image, layered and joint-bound.
//
//   node skin/build-rig.mjs [clip|all]   build clips
//   node skin/build-rig.mjs --layers     dump the cut layers
//
// A single transparent master (poses/idle.png) is segmented into layers — torso,
// head, both ears, one front paw — and each layer is bound to a joint with a parent
// and a pivot. Every clip is a pose over that hierarchy, so all states share one
// body: switching clips can no longer jump between differently drawn dogs. Motion
// comes from springs and incommensurate noise on the joints; the frames are baked
// to the webp sequence the native helper consumes.
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { SS, WIDTH, HEIGHT, LOGICAL_WIDTH, LOGICAL_HEIGHT, CX, PAW, inPoly, BONES, SLEEP_BONES, SLEEP_HEAD, BACK_BONES, NECK_OVERLAP, OUTLINE_DEPTH, rigContext } from './rig.mjs'
import { sharp } from './sharp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const POSE_DIR = join(HERE, 'poses')
const LAYER_DIR = join(HERE, 'layers')
const OUT_ROOT = join(HERE, 'frames')
const TAU = 2 * Math.PI
/** Fraction of a requested ear angle the cut can carry without dragging its root outline across the crown. */
const PERK = 0.02
/**
 * One master and one set of bones per body the skin draws. A clip names its rig with
 * `rig:`, and the sitting body is the default. Lying down is a different drawing, not a
 * pose over the sitting one: no joint of the sitting rig can fold a dog onto the desktop
 * with its head on its paws. The lying master is awake — its eyes are open and the sleep
 * clip closes them with lids — so waiting, sleeping, and the two bridges between the
 * bodies all draw the same animal.
 */
const RIGS = {
  sitting: { master: join(POSE_DIR, 'idle.png'), bones: BONES, face: true },
  lying: { master: join(POSE_DIR, 'lying.png'), bones: SLEEP_BONES, face: { head: [92, 245, 219, 300] } },
  back: { master: join(POSE_DIR, 'back.png'), bones: BACK_BONES, face: false },
}

// ---------------------------------------------------------------- rig geometry

const ell = (cx, cy, rx, ry, fill = '#fff') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`

// ------------------------------------------------------------------- math utils

/**
 * A waveform with the shape of noise and the periodicity a looping clip needs: whole
 * harmonics at unrelated phases. Incommensurate frequencies were the original trick and
 * they cost a jump where the loop wraps — a half-cycle term is somewhere else in its
 * swing at frame 0 than at the last frame, so the dog ticks once per loop.
 */
function snoise(t) {
  const x = TAU * t
  return 0.56 * Math.sin(x) + 0.27 * Math.sin(2 * x + 1.3) + 0.12 * Math.sin(3 * x + 4.2) + 0.05 * Math.sin(6 * x + 2.1)
}
/** Ramp 0→1→0 across a one-shot clip, easing through `inF` and `outF` of its length. */
function pulse(t, inF, outF) {
  const s = (x) => x * x * (3 - 2 * x)
  if (t < inF) return s(t / inF)
  if (t > 1 - outF) return s((1 - t) / outF)
  return 1
}

/**
 * One event inside a clip: rise over `atk` of its span, hold, fall over what is left.
 * The hold is what separates a gesture from an oscillation — a pose taken, kept, and
 * given back. The envelope vanishes outside its span, so a loop assembled from events
 * still joins itself at the wrap and a one-shot still starts and ends at rest.
 */
function env(t, at, span, atk = 0.3, hold = 0.2) {
  const s = (x) => x * x * (3 - 2 * x)
  const q = (t - at) / span
  if (q <= 0 || q >= 1) return 0
  if (q < atk) return s(q / atk)
  if (q < atk + hold) return 1
  return s(1 - (q - atk - hold) / (1 - atk - hold))
}

/**
 * Asymmetric breath: phase modulation quickens the inhale against the exhale, so the
 * chest does not rise and fall as the same ramp — a symmetric sine reads as a pump
 * handle. Period 1 and whole harmonics only, so a looping clip joins itself at the wrap.
 */
const bwave = (t) => Math.sin(TAU * t + 0.4 * Math.sin(TAU * t))

/**
 * Heartbeat-level tremor, a lub-dub pair near 2 Hz scaled by `gate`: it is felt only
 * when the body is otherwise still, and it is what keeps a held pose from reading as
 * a painting. Whole harmonics of the clip, so loops close.
 */
const heart = (t, n, gate) => gate * 0.35 * (Math.sin(TAU * n * t) + 0.5 * Math.sin(TAU * (2 * n + 1) * t + 0.9))
/**
 * One tongue lick inside a clip: out from the lips, a drag up across the muzzle, back.
 * @returns `e` how far out the tongue is (0 inside the mouth, 1 at the top of the sweep) and
 * `whip` its rate of travel, which bends the lobe one way as it sets out and the other as
 * it returns. The extension has no plateau: a held peak reads as the tongue frozen mid-lick.
 */
function lick(t, at, span = 0.22) {
  const q = (t - at) / span
  if (q < 0 || q > 1) return { e: 0, whip: 0 }
  // A power above one so the extension starts and stops at zero rate. At 0.85 the slope at
  // the ends is infinite, and the tongue snapped out of the mouth and back in over one
  // frame — measured, 14.7px of travel between two 40ms frames.
  return { e: Math.pow(Math.sin(Math.PI * q), 1.35), whip: Math.cos(Math.PI * q) }
}
/**
 * How far the paw is off the ground, 0 planted to 1 raised against the chest. The reach
 * comes from the height rather than the turn: the foot's leg lines are vertical, so
 * sliding them up keeps them collinear with the leg above and shows no break, while a
 * turn is what bends them away at the wrist. The turn stays small for that reason.
 */
const pawRaise = (k, swing = 0) => ({ angle: 30 * k + 10 * swing, dy: -34 * k })

/** Deterministic 32-bit seed from a string, so a clip's randomization is stable across builds. */
function seedOf(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
/** mulberry32. */
function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Affine 2x3 in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
function mul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
  }
}
const translate = (tx, ty) => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty })
function rotate(deg) { const r = deg * Math.PI / 180, s = Math.sin(r), c = Math.cos(r); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 } }
const scale = (sx, sy) => ({ a: sx, b: 0, c: 0, d: sy ?? sx, e: 0, f: 0 })
const about = (p, m) => mul(translate(p[0], p[1]), mul(m, translate(-p[0], -p[1])))
const fmt = m => `${m.a.toFixed(4)} ${m.b.toFixed(4)} ${m.c.toFixed(4)} ${m.d.toFixed(4)} ${m.e.toFixed(2)} ${m.f.toFixed(2)}`

/**
 * Damped-spring angles driven by occasional flick impulses, so appendages overshoot
 * and settle like tissue rather than a scripted sine.
 * @param frames - clip frame count. @param frameMs - frame duration. @param seed - stable clip seed.
 * @param opts - `amp` impulse size, `k` stiffness, `zeta` damping, `loop` to rejoin frame 0.
 * @returns per-frame angle in degrees.
 */
function springAngles(frames, frameMs, seed, opts = {}) {
  const { amp = 22, k = 55, zeta = 0.32, loop = false } = opts
  const r = rng(seed)
  const dt = frameMs / 1000
  const c = 2 * zeta * Math.sqrt(k)
  const impulses = new Map()
  let at = 20 + Math.floor(r() * 30)
  while (at < frames) { impulses.set(at, (r() < 0.5 ? -1 : 1) * amp * (0.5 + r() * 0.8)); at += 26 + Math.floor(r() * 55) }
  let a = 0, v = 0
  const out = []
  for (let i = 0; i < frames; i++) {
    if (impulses.has(i)) v += impulses.get(i)
    v += (-k * a - c * v) * dt
    a += v * dt
    out.push(a)
  }
  if (!loop) return out
  // Blend the tail back into frame 0 so a looping clip has no seam at the wrap point.
  const tail = Math.min(frames - 1, 10)
  return out.map((x, i) => {
    if (i < frames - tail) return x
    const w = (i - (frames - tail)) / tail
    return x * (1 - w) + out[0] * w
  })
}

// ------------------------------------------------------------------ layer build

/**
 * @param masterPath - the pose master to read.
 * @param face - whether the rig draws eyes, a mouth and a tongue over the master, and where
 *   its head sits when the body is not centered under it. The anchors come from the dark ink
 *   either side of the head's own axis, so a lying dog whose head is off to one side needs
 *   that axis named: the silhouette's center is somewhere down its back.
 * @returns master pixels, and the eye, nose and fur anchors when there is a face to place.
 */
async function readMaster(masterPath, face) {
  const { data, info } = await sharp(masterPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info
  if (face === false) return { data, w, h, c, eyes: null, nose: null }
  const head = face.head === undefined ? null : face.head.map((v) => v * SS)
  const inHead = (x, y) => head === null || (x >= head[0] && x <= head[2] && y >= head[1] && y <= head[3])
  let bx0 = w, bx1 = 0, by0 = h, by1 = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * c + 3] < 200 || !inHead(x, y)) continue
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y
  }
  const cx = (bx0 + bx1) / 2
  const acc = { left: { x: 0, y: 0, n: 0 }, right: { x: 0, y: 0, n: 0 } }
  const noseHalf = Math.round((bx1 - bx0) * 0.11)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * c
    if (data[p + 3] < 200 || !inHead(x, y)) continue
    if (data[p] < 110 && data[p + 1] < 90 && data[p + 2] < 80) {
      // The central nose column is skipped so only the two side eyes are averaged.
      if (x < cx - noseHalf) { acc.left.x += x; acc.left.y += y; acc.left.n += 1 }
      else if (x > cx + noseHalf) { acc.right.x += x; acc.right.y += y; acc.right.n += 1 }
    }
  }
  if (acc.left.n === 0 || acc.right.n === 0) throw new Error('eyes not found in master')
  const eye = (a) => ({ x: a.x / a.n, y: a.y / a.n })
  const le = eye(acc.left), re = eye(acc.right)
  const radius = Math.max(12 * SS, Math.round(Math.sqrt(acc.left.n / Math.PI) + 2))
  const eyeRing = radius + 6 * SS
  // Body fur tone for the eyelids, read from the ring around each eye. Filtering to the
  // tan band keeps the pale forehead blaze and the dark eye itself out of the average.
  let sr = 0, sg = 0, sb = 0, n = 0
  for (const e of [le, re]) for (let a = 0; a < 360; a += 6) {
    const x = Math.round(e.x + eyeRing * Math.cos(a * Math.PI / 180))
    const y = Math.round(e.y + eyeRing * Math.sin(a * Math.PI / 180))
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const p = (y * w + x) * c
    if (data[p + 3] < 200) continue
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum < 170 || lum > 225 || r - b < 60 || r - b > 95) continue
    sr += r; sg += g; sb += b; n += 1
  }
  const fur = n > 0 ? `rgb(${Math.round(sr / n)} ${Math.round(sg / n)} ${Math.round(sb / n)})` : 'rgb(234 202 160)'
  const nose = { x: (le.x + re.x) / 2, y: le.y + Math.abs(re.x - le.x) * 0.36 }
  // The face overlays are authored in logical units and scaled once on the way out, so
  // the anchors read off the master come back down to that space.
  const lg = (e) => ({ x: e.x / SS, y: e.y / SS })
  return { data, w, h, c, eyes: { left: lg(le), right: lg(re), radius: radius / SS, fur }, nose: lg(nose) }
}

/**
 * How deep each pixel sits inside the master's silhouette, in device pixels.
 * The neck band needs this to tell the body's own outline, which runs along the silhouette,
 * from the jowl's line, which is ink inside the coat: only the latter gets repainted, so the
 * outline survives on the band and stays one continuous stroke while the head is raised.
 * @param master - the master's raw RGBA pixels. @returns one byte per pixel, 0 outside the
 * silhouette and capped at 32 within it.
 */
function depthFromEdge(master) {
  const { w, h, data, c } = master
  const solid = (i) => data[i * c + 3] > 8
  const depth = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0, tail = 0
  for (let i = 0; i < w * h; i++) if (!solid(i)) queue[tail++] = i
  while (head < tail) {
    const i = queue[head++]
    const d = depth[i] + 1
    if (d > 32) continue
    const x = i % w, y = (i / w) | 0
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || !solid(j) || depth[j] !== 0) continue
      depth[j] = d
      queue[tail++] = j
    }
  }
  return depth
}

/**
 * Cut a master into its rig's bone layers, each stored cropped to its own bounds.
 * @param rig - the master, bones and face flag named in `RIGS`.
 * @param dir - where to write the cut layers.
 * @returns `{ id, png, bx, by, bw, bh }` per layer, in paint order, with the face anchors.
 */
async function buildLayers(rig, dir) {
  const master = await readMaster(rig.master, rig.face)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const layers = []
  const g = rigContext(master.data, master.c)
  const depth = depthFromEdge(master)
  const raw = (buf) => sharp(buf, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
  for (const bone of rig.bones) {
    const mask = bone.region(g)
    const buf = Buffer.alloc(WIDTH * HEIGHT * 4)
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const m = mask[y * WIDTH + x]
      if (m === 0) continue
      const p = (y * master.w + x) * master.c
      if (master.data[p + 3] === 0) continue
      const o = (y * WIDTH + x) * 4
      buf[o] = master.data[p]; buf[o + 1] = master.data[p + 1]; buf[o + 2] = master.data[p + 2]
      buf[o + 3] = Math.round(master.data[p + 3] * m / 255)
    }
    if (bone.fur !== undefined) {
      // The band above the seam keeps the body's plain fur but none of its line work:
      // a copied outline stands out past the body's edge as a dark wedge the moment the
      // head swings off it. Only ink is repainted, so the fur's own shading survives.
      // The darkness cut is taken across the whole band at once — a per-column threshold
      // erases one column and spares its neighbour, which combs the band.
      const half = SS >> 1
      const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b
      const furRow = (lx) => Math.min(HEIGHT - 1, Math.round(bone.fur(lx) * SS) + half)
      for (let lx = 0; lx < LOGICAL_WIDTH; lx++) {
        let sr = 0, sg = 0, sb = 0, sn = 0
        for (let sx = lx - 3; sx <= lx + 3; sx++) {
          if (sx < 0 || sx >= LOGICAL_WIDTH) continue
          for (let dy = 0; dy <= 2 * half; dy++) {
            const q = ((furRow(sx) + dy) * master.w + sx * SS + half) * master.c
            if (master.data[q + 3] < 200 || lum(master.data[q], master.data[q + 1], master.data[q + 2]) < 150) continue
            sr += master.data[q]; sg += master.data[q + 1]; sb += master.data[q + 2]; sn++
          }
        }
        if (sn === 0) continue
        const fr = sr / sn, fg = sg / sn, fb = sb / sn
        const top = Math.max(0, Math.round((bone.fur(lx) - NECK_OVERLAP) * SS))
        // The whole band takes the smoothed fur color. Erasing only the dark pixels leaves
        // the antialiased edge of the copied outline half-removed, which reads as a line of
        // stitches; and the color is averaged over seven columns because a single sample
        // carries the master's own pixel noise and combs the band.
        for (let y = top; y < Math.min(HEIGHT, furRow(lx)); y++) {
          // Every device pixel of the logical column, not just the sampled one: filling one
          // of two leaves a comb of alternating columns along the band's edge.
          for (let dx = 0; dx < SS; dx++) {
            const i = y * master.w + lx * SS + dx
            const o = i * 4
            if (buf[o + 3] === 0) continue
            // The silhouette's own line stays. Measured across the band it runs nine to
            // twelve device pixels in from the edge, and the jowl's line, which is what the
            // band exists to remove, sits inside it; erasing both leaves the body's outline
            // a bare stretch of coat whenever the head is raised.
            if (depth[i] <= OUTLINE_DEPTH) continue
            buf[o] = fr; buf[o + 1] = fg; buf[o + 2] = fb
          }
        }
      }
    }
    if (bone.floor !== undefined) {
      // The paw bone lifts the leg's lower half with it, and the master draws no underside
      // behind that leg, so the body is left with a flat cut of bare coat and its outline
      // stops dead at the raised foot. Close that cut the way the masters close a bare rim:
      // the master's own line color, faded over the line's measured width. The stroke lands
      // inside the paw's own footprint, so the paw hides it until it leaves.
      const md = master.data
      const lum = (i) => 0.3 * md[i * master.c] + 0.59 * md[i * master.c + 1] + 0.11 * md[i * master.c + 2]
      let sr = 0, sg = 0, sb = 0, sn = 0
      for (let i = 0; i < master.w * master.h; i++) {
        if (depth[i] < 1 || depth[i] > 6 || md[i * master.c + 3] < 200 || lum(i) > 165) continue
        sr += md[i * master.c]; sg += md[i * master.c + 1]; sb += md[i * master.c + 2]; sn++
      }
      if (sn > 0) {
        const line = [sr / sn, sg / sn, sb / sn]
        const cut = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT
          && inPoly(PAW, x / SS, y / SS) && y / SS >= bone.floor
        const d = new Uint8Array(WIDTH * HEIGHT)
        const queue = new Int32Array(WIDTH * HEIGHT)
        let head = 0, tail = 0
        for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
          const i = y * WIDTH + x
          if (buf[i * 4 + 3] === 0 || !cut(x, y)) continue
          d[i] = 0
          for (const j of [i - 1, i + 1, i - WIDTH, i + WIDTH]) if (j >= 0 && j < WIDTH * HEIGHT && buf[j * 4 + 3] > 0 && d[j] === 0 && !cut((j % WIDTH), ((j / WIDTH) | 0))) { d[j] = 1; queue[tail++] = j }
        }
        while (head < tail) {
          const i = queue[head++]
          const nd = d[i] + 1
          if (nd > OUTLINE_DEPTH) continue
          const x = i % WIDTH, y = (i / WIDTH) | 0
          for (const j of [i - 1, i + 1, i - WIDTH, i + WIDTH]) {
            if (j < 0 || j >= WIDTH * HEIGHT) continue
            if (buf[j * 4 + 3] === 0 || d[j] !== 0 || cut(j % WIDTH, (j / WIDTH) | 0)) continue
            d[j] = nd
            const reach = Math.min(1, (OUTLINE_DEPTH - nd) / 4)
            const o = j * 4
            for (let c = 0; c < 3; c++) buf[o + c] = Math.round(buf[o + c] * (1 - reach) + line[c] * reach)
            queue[tail++] = j
          }
        }
      }
    }
    const png = await raw(buf).png().toBuffer()
    const { data: px, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let x0 = WIDTH, y0 = HEIGHT, x1 = 0, y1 = 0
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      if (px[(y * info.width + x) * info.channels + 3] < 6) continue
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    if (x1 < x0) throw new Error(`layer ${bone.id} is empty`)
    const pad = 8 * SS
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
    x1 = Math.min(WIDTH - 1, x1 + pad); y1 = Math.min(HEIGHT - 1, y1 + pad)
    const crop = await sharp(png).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer()
    layers.push({ ...bone, png: crop, bx: x0, by: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 })
    writeFileSync(join(dir, `${bone.id}.png`), crop)
  }
  return { layers, eyes: master.eyes, nose: master.nose }
}

// ------------------------------------------------------------------ face extras

/**
 * Blink closedness 0..1 over a lid profile: quick close, a brief hold, slower open.
 * A symmetric ramp reads as a mechanical wipe rather than as a lid.
 */
function blinkAmount(t, blinkAt) {
  const span = 0.075
  const d = (t - blinkAt) / span
  if (d < 0 || d > 1) return 0
  const s = (x) => x * x * (3 - 2 * x)
  if (d < 0.3) return s(d / 0.3)
  if (d < 0.42) return 1
  return 1 - s((d - 0.42) / 0.58)
}

/**
 * Eyelids, an open mouth, a tongue and dizzy eyes, in master coordinates inside the head's
 * matrix.
 * @param eyes - the rig's eye anchors.
 * @param nose - the rig's nose anchor.
 * @param pose - the face channels of this frame's pose.
 * @param ns - suffix for the clip-path ids. A frame can carry two faces at once, and one
 *   SVG document resolves a duplicated id to its first definition, so without this the
 *   second face's lids are cut to the first face's eyes.
 */
function faceSvg(eyes, nose, { blink = 0, mouth = 0, lick = 0, whip = 0, dizzy = 0, spin = 0, brow = 0 }, ns = '') {
  const n = (v) => v.toFixed(1)
  const parts = []
  if (dizzy > 0.01) {
    const r = eyes.radius
    for (const [i, e] of [eyes.left, eyes.right].entries()) {
      // The cover is the eyelid's own shape, not a fresh disc: it already matches the fur
      // around the eye and ends on a lash line, where a disc of the same tone reads as a
      // pale spot on the face.
      parts.push(`<g clip-path="url(#lid${i}${ns})"><rect x="${n(e.x - r * 1.5)}" y="${n(e.y - r * 1.6)}" width="${n(r * 3)}" height="${n(r * 3.4)}" fill="${eyes.fur}"/></g>`)
      // A loose one-and-a-half turn, thinner than the eye it replaces: two and a half turns
      // at this size read as a fingerprint rather than as a spin.
      const steps = 34
      let d = ''
      for (let k = 0; k <= steps; k++) {
        const u = k / steps
        const a = spin + u * 1.5 * TAU
        const rad = r * (0.22 + 0.5 * u)
        d += `${k ? ' L' : 'M'}${n(e.x + Math.cos(a) * rad)} ${n(e.y + Math.sin(a) * rad * 0.86)}`
      }
      parts.push(`<path d="${d}" fill="none" stroke="#5a4230" stroke-width="2" stroke-linecap="round" opacity="${(0.45 + 0.55 * dizzy).toFixed(2)}"/>`)
    }
  }
  if (blink > 0.01) {
    const r = eyes.radius
    // The lid sweeps down from above the eye and stops just under its center, so the
    // closed state ends on a curved lash line instead of erasing the eye.
    const top = eyes.left.y - r * 1.3
    for (const [i, e] of [eyes.left, eyes.right].entries()) {
      const margin = top + (e.y + r * 0.45 - top) * blink
      const arc = (w, bulge) => `M${n(e.x - w)} ${n(margin)} Q${n(e.x)} ${n(margin + bulge)} ${n(e.x + w)} ${n(margin)}`
      parts.push(`<g clip-path="url(#lid${i}${ns})"><rect x="${n(e.x - r * 1.5)}" y="${n(top - r)}" width="${n(r * 3)}" height="${n(margin - top + r)}" fill="${eyes.fur}"/>`
        + `<path d="${arc(r * 1.5, r * 0.55)} L${n(e.x + r * 1.5)} ${n(top - r)} L${n(e.x - r * 1.5)} ${n(top - r)} Z" fill="${eyes.fur}"/></g>`)
      parts.push(`<path d="${arc(r * 1.12, r * 0.5)}" fill="none" stroke="#5a4230" stroke-width="2.2" stroke-linecap="round" opacity="${n(0.3 + 0.7 * blink)}"/>`)
    }
  }
  const open = Math.max(mouth, lick * 0.55)
  if (brow > 0.02) {
    // The art already raises a short arc over each eye, and it ends a little higher on the
    // outside than on the inside. Attention is that slant taken further: the hook carries the
    // arc's inner end down toward the nose bridge, which is what turns a raised brow into a
    // drawn one. It extends the drawing rather than replacing it — a second brow laid over
    // the first leaves two lines, and painting the first back to flat coat showed as its own
    // smear, because the brow band is not one color: the ear roots shade it toward pink
    // where it meets the side of the head.
    for (const side of [-1, 1]) {
      const y = (side < 0 ? eyes.left : eyes.right).y
      parts.push(`<g opacity="${n(brow)}"><path d="M${n(nose.x + side * 35)} ${n(y - 23.5)} Q${n(nose.x + side * 30)} ${n(y - 19)} ${n(nose.x + side * 24)} ${n(y - 12)}" fill="none" stroke="#b07d55" stroke-width="4.6" stroke-linecap="round"/></g>`)
    }
  }
  if (open <= 0.02) return parts.length ? `<defs>${lidClips(eyes, ns)}</defs>${parts.join('')}` : ''
  const mw = 13 + 10 * open, mh = 5 + 13 * open
  const my = nose.y + 13 + mh * 0.35
  if (open > 0.05) parts.push(ell(n(nose.x), n(my), n(mw), n(mh), '#5b3a2c'))
  // The tongue is a lobe that curls along its own length, not a flap hinged at the lips:
  // rotating a straight shape about its root is a card flip. Its tip leaves the mouth
  // hanging, travels up the muzzle, and stops under the nose's leather — a lick that passes
  // over the nose reads as a bandage on the face. The sideways travel is wider on the way
  // out than on the way back, which is what makes it a drag across rather than a shuttle.
  const rx = nose.x, ry = my + mh * 0.2
  const hang = 11 + 6 * open
  const tx = rx + (9 + 5 * whip) * lick
  const ty = ry + hang - (hang + 18) * lick
  const nx = (ty - ry), ny = -(tx - rx)
  const len = Math.hypot(nx, ny) || 1
  const bend = 11 * whip + 4 * lick
  const cx = (rx + tx) / 2 + (nx / len) * bend, cy = (ry + ty) / 2 + (ny / len) * bend
  const w = 17 + 9 * open
  // A stroke has round caps but no taper, and a tongue as thick at the tip as at the root
  // reads as a finger. Nor may it narrow all the way to a point: that is a wedge, and a
  // dog's tongue is a lobe that comes out from between the lips, widens, and rounds off.
  // So the half-width eases in over the root, holds its belly, and gives up only a third at
  // the very tip, where a circular cap closes it.
  const at_ = (k) => {
    const u = 1 - k
    return [u * u * rx + 2 * u * k * cx + k * k * tx, u * u * ry + 2 * u * k * cy + k * k * ty]
  }
  const normal = (k) => {
    const u = 1 - k
    const dx = 2 * u * (cx - rx) + 2 * k * (tx - cx)
    const dy = 2 * u * (cy - ry) + 2 * k * (ty - cy)
    const len = Math.hypot(dx, dy) || 1
    return [dy / len, -dx / len]
  }
  const steps = 8
  const one = [], other = []
  const half = (k) => (w / 2) * (0.8 + 0.2 * Math.min(1, k / 0.28)) * (1 - 0.34 * k ** 3)
  for (let i = 0; i <= steps; i++) {
    const k = i / steps
    const [px, py] = at_(k), [ox, oy] = normal(k)
    const h = half(k)
    one.push([px + ox * h, py + oy * h])
    other.push([px - ox * h, py - oy * h])
  }
  // The tip closes on a round cap rather than a notch cut into the silhouette: at this size
  // the cut is what made the tongue read as a pointed tab, and a fork drawn as line work
  // keeps the lobe whole.
  const tdx = tx - cx, tdy = ty - cy, tl = Math.hypot(tdx, tdy) || 1
  const dir = [tdx / tl, tdy / tl]
  const cap = half(1) * 1.15
  const capOut = (pt) => [pt[0] + dir[0] * cap, pt[1] + dir[1] * cap]
  const [c1x, c1y] = capOut(one[steps]), [c2x, c2y] = capOut(other[steps])
  const outline = (pts) => pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')
  const d = `M${outline(one)} C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(other[steps][0])} ${n(other[steps][1])} L${outline(other.reverse())} Z`
  const groove = `M${n(at_(0.3)[0])} ${n(at_(0.3)[1])} Q${n(cx)} ${n(cy)} ${n(at_(0.9)[0])} ${n(at_(0.9)[1])}`
  const [fx, fy] = at_(0.97)
  const fork = `M${n(fx - dir[0] * cap * 0.55)} ${n(fy - dir[1] * cap * 0.55)} L${n(fx + dir[0] * cap * 0.2)} ${n(fy + dir[1] * cap * 0.2)}`
  parts.push(`<path d="${d}" fill="#ef8496" stroke="#c2607a" stroke-width="1.7" stroke-linejoin="round"/>`
    + `<path d="${groove}" fill="none" stroke="#d3708a" stroke-width="${n(w * 0.13)}" stroke-linecap="round" opacity="0.85"/>`
    + `<path d="${fork}" fill="none" stroke="#c2607a" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>`)
  return `<defs>${lidClips(eyes, ns)}</defs>${parts.join('')}`
}

/** @param eyes - detected eye anchors. @returns the clip paths that keep lids on the eyes. */
function lidClips(eyes, ns = '') {
  const r = eyes.radius * 1.3
  return [eyes.left, eyes.right].map((e, i) => `<clipPath id="lid${i}${ns}">${ell(e.x.toFixed(1), (e.y - r * 0.08).toFixed(1), r.toFixed(1), r.toFixed(1))}</clipPath>`).join('')
}

/**
 * The laptop the dog works at, seen from the far side. The dog faces the viewer and faces
 * the screen, so the screen faces away: what the viewer gets is the back of the lid standing
 * on the desk, with the base behind it, the keys under it, and the dog's front paws behind it
 * too. The machine is wider than the dog is and the paws are on its far side, so nothing of
 * the typing can be seen from here — the only place it can show is the shoulders that reach
 * the paws around there. `typingSchedule` hands its taps to the pose for exactly that.
 */
function typingSvg() {
  const n = (v) => v.toFixed(1)
  const desk = 332
  // The lid reaches the desktop rather than stopping short of it: the dog's own front feet
  // rest two pixels below, and a shell that leaves them showing is the whole illusion lost.
  // The shell's bottom edge sits below the desktop line the dog's own feet stand on, so the
  // feet stay behind it however the body moves: the machine's near edge is the lower thing on
  // screen, and the contact shadow is drawn there rather than at the dog's ground line.
  const top = 272, bottom = desk + 7
  const topW = 178, bottomW = 200, baseW = 224, baseH = 9
  const lid = `M${n(CX - topW / 2)} ${n(top)} Q${n(CX - topW / 2 - 1)} ${n(top - 6)} ${n(CX - topW / 2 + 6)} ${n(top - 6)} L${n(CX + topW / 2 - 6)} ${n(top - 6)} Q${n(CX + topW / 2 + 1)} ${n(top - 6)} ${n(CX + topW / 2)} ${n(top)} L${n(CX + bottomW / 2)} ${n(bottom)} L${n(CX - bottomW / 2)} ${n(bottom)} Z`
  return `<ellipse cx="${n(CX)}" cy="${n(bottom - 1)}" rx="${n(baseW / 2 + 6)}" ry="4" fill="#000" opacity="0.13"/>
    <rect x="${n(CX - baseW / 2)}" y="${n(desk - baseH)}" width="${n(baseW)}" height="${n(baseH)}" rx="3.5" fill="#98a3b0" stroke="#6e4a2a" stroke-width="3"/>
    <path d="${lid}" fill="#b9c4d0" stroke="#6e4a2a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${n(CX - topW / 2 + 6)} ${n(top - 5)} L${n(CX + topW / 2 - 6)} ${n(top - 5)}" fill="none" stroke="#d8e0e8" stroke-width="3" stroke-linecap="round"/>
    <path d="M${n(CX - bottomW / 2 + 14)} ${n(bottom - 2)} L${n(CX + bottomW / 2 - 14)} ${n(bottom - 2)}" fill="none" stroke="#8e9aa8" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="${n(CX)}" cy="${n((top + bottom) / 2 - 3)}" rx="17" ry="15" fill="#cfd8e2" stroke="#6e4a2a" stroke-width="2.4"/>
    <g transform="translate(${n(CX)} ${n((top + bottom) / 2 - 3)}) scale(0.78)"><path d="M0 -13 L5 -4 L14 -3 L7 3 L9 11 L0 6 L-9 11 L-7 3 L-14 -3 L-5 -4 Z" fill="#f2e6cd"/></g>`
}

/**
 * Bursty, irregular keystroke schedules over a clip's frames.
 *
 * A paw lifts and sets down to strike, and reaches sideways for a different key now and
 * then; the sideways travel eases toward its target over several frames, because a paw that
 * jumps eight pixels is a paw that teleports rather than slides. Bursts are separated by
 * gaps with both paws down, which is what makes a burst read as typing rather than as
 * shaking.
 */
function typingSchedule(frames, seed, rest) {
  const r = rng(seed)
  const L = [], R = []
  const target = { L: 0, R: 0 }, slide = { L: 0, R: 0 }
  // `rest` is a window of the clip, as fractions of its length, where the paws are down and
  // nothing strikes. A clip that types straight through at one rate is a metronome; a clip
  // that stops is a dog waiting for something to finish.
  const idle = (i) => rest !== undefined && i / frames >= rest[0] && i / frames < rest[1]
  const put = (liftL, liftR) => {
    for (const k of ['L', 'R']) slide[k] += (target[k] - slide[k]) * 0.3
    L.push({ lift: liftL, slide: slide.L })
    R.push({ lift: liftR, slide: slide.R })
  }
  let i = 0
  while (i < frames) {
    if (idle(i)) { put(0, 0); i += 1; continue }
    const burst = 3 + Math.floor(r() * 7)
    for (let b = 0; b < burst && i < frames; b++) {
      const side = r() < 0.12 ? ['L', 'R'] : [r() < 0.5 ? 'L' : 'R']
      if (r() < 0.45) for (const k of side) target[k] = r() < 0.5 ? -1 : 1
      const dur = 3 + Math.floor(r() * 3)
      for (let d = 0; d < dur && i < frames && !idle(i); d++) {
        const env = Math.sin(Math.PI * (d / dur))
        put(side.includes('L') ? env : 0, side.includes('R') ? env : 0)
        i += 1
      }
    }
    for (let g = 0, stop = 2 + Math.floor(r() * 5); g < stop && i < frames; g++) { put(0, 0); i += 1 }
  }
  return { L, R }
}

/**
 * What a pair of unseen keystrokes does to the shoulders that make them.
 *
 * `strike` is whichever paw is down on this frame, `side` which of the two it was, `lean`
 * how far the reach has carried the paws sideways, and `reach` is the pair of them at once.
 * A pose uses these to press one shoulder down and roll the body onto it, so the work reads
 * from the side of the machine the paws are hidden behind.
 *
 * @param tap - the frame's `{ L, R }` paws, each with `lift` and `slide`.
 * @returns The four shoulder signals, all in pose units.
 */
function shoulders({ L, R }) {
  return {
    strike: Math.max(L.lift, R.lift),
    side: R.lift - L.lift,
    lean: (L.slide + R.slide) / 2,
    reach: Math.max(Math.abs(L.slide), Math.abs(R.slide)),
  }
}

// -------------------------------------------------------------------- the rig

/**
 * Drive a per-frame target through a damped spring instead of applying it as asked.
 *
 * A pose that arrives frame-for-frame moves like a metronome; the same request through a
 * spring overshoots and settles, and the gap between the spring and its target is the
 * body still traveling under a head that has not caught up — which is what the head lags
 * on. Loops run three cycles of their periodic target so the transient dies out and the
 * returned cycle joins onto its own first frame.
 *
 * @param target - the requested value, one entry per frame.
 * @param dt - seconds per frame.
 * @param opts - stiffness, damping ratio, and whether the series wraps.
 * @returns the spring's position, one entry per frame.
 */
function springFollow(target, dt, { k = 40, zeta = 0.6, loop = false } = {}) {
  const c = 2 * zeta * Math.sqrt(k)
  const series = loop ? [...target, ...target, ...target] : target
  let a = target[0], v = 0
  const out = []
  for (const asked of series) {
    v += (k * (asked - a) - c * v) * dt
    a += v * dt
    out.push(a)
  }
  return out.slice(out.length - target.length)
}

/** Breathing: volume-preserving stretch about the feet. */
const breathe = (t, a) => ({ sx: 1 - a * 0.5 * bwave(t), sy: 1 + a * bwave(t) })

/**
 * One success hop over q in [0,1), keyframed piecewise rather than shaped from a sine,
 * so each hop carries its own anticipation: the crouch at q 0.58–0.68 precedes the
 * launch, the landing squashes at q 0.0–0.3, and the settle holds before the next
 * crouch. A sine hop has no phases, and without a crouch the jump reads as floating.
 * `dy` is down-positive like the torso channel; `sx`/`sy` are multipliers. Two hops
 * per `success` loop, so the returned gates are also what the head and mouth read.
 */
function hop(q) {
  const keys = [
    [0.00, 0.0, 0.975, 1.015], [0.14, 1.8, 0.945, 1.05], [0.30, 0.5, 0.985, 1.01],
    [0.58, 0.0, 1.0, 1.0], [0.68, 2.9, 0.972, 1.022], [0.78, -7.0, 1.042, 0.984],
    [0.90, -13.5, 1.038, 0.988], [1.00, 0.0, 0.975, 1.015],
  ]
  const s = (x) => x * x * (3 - 2 * x)
  let i = 0
  while (i < keys.length - 2 && q > keys[i + 1][0]) i++
  const [qa, ...va] = keys[i], [qb, ...vb] = keys[i + 1]
  const w = s((q - qa) / (qb - qa))
  const [dy, sy, sx] = va.map((a, k) => a + (vb[k] - a) * w)
  const band = (a, b) => { const x = Math.max(0, Math.min(1, (q - a) / (b - a))); return s(x) }
  const air = band(0.78, 0.90) * (q >= 0.5 ? 1 - band(0.96, 1.0) : 1 - band(0.02, 0.10))
  const squash = band(0.0, 0.09) * (1 - band(0.24, 0.38))
  const crouch = band(0.58, 0.68) * (1 - band(0.74, 0.84))
  return { dy, sy, sx, air, squash, crouch }
}

/**
 * Three Zs rising off the sleeping head, a third of a loop apart so a new one starts as
 * the last fades. Drawn as a stroked path rather than a glyph: the bake must not depend
 * on a font being installed, and the outline-then-fill pair is how the art draws
 * everything else.
 */
function bubblesSvg(t) {
  const n = (v) => v.toFixed(1)
  const z = (x, y, s, o) => {
    const w = 7 * s, h = 9 * s
    const d = `M${n(x - w / 2)} ${n(y - h / 2)} L${n(x + w / 2)} ${n(y - h / 2)} L${n(x - w / 2)} ${n(y + h / 2)} L${n(x + w / 2)} ${n(y + h / 2)}`
    return `<path d="${d}" fill="none" stroke="#6e4a2a" stroke-width="${n(3.4 * s)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(o)}"/>`
      + `<path d="${d}" fill="none" stroke="#f7efdd" stroke-width="${n(1.8 * s)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(o)}"/>`
  }
  const [hx, hy] = SLEEP_HEAD
  const out = []
  for (let i = 0; i < 3; i++) {
    const p = (t + i / 3) % 1
    out.push(z(hx + 22 * p + i * 4, hy - 40 * p, 0.85 + 0.75 * p, Math.sin(Math.PI * p) * 0.95))
  }
  return out.join('')
}

/**
 * One pose function per clip. Channels are offsets from the rest pose, so a clip
 * that sets nothing renders exactly the master. `e` carries per-frame schedules.
 *
 * Where an action goes is decided by what the cut can carry, not by what a dog's body
 * part is called. The torso is the base bone: leaning it about the feet, squashing it
 * about the feet, or shifting it moves the crown by tens of pixels and drags the neck
 * seam along with the head, so the seam never opens. The head's own travel is bounded by
 * the waist the seam crosses (see `clampHead`), which leaves it the bob, a small tilt, and
 * the perk. So "turn to look" is a weight shift of the whole body with the head riding,
 * and "dip the head" is a squash about the feet — both read better than a head sliding on
 * its own, because a sitting dog does exactly that.
 *
 * Noise terms take `snoise(t * n + phase)` with `n` a whole number: the argument is a
 * fraction of the clip, so any other `n` leaves a jump where the loop wraps.
 */
const POSES = {
  /**
   * Three unequal events per loop — a weight shift, a long look, a sniff dip — plus the
   * ear flicks the ear spring fires on its own. Between events the dog holds, with only
   * the breath and the heartbeat tremor: stillness is what makes the next event read.
   * Measured on the baked frames, the previous idle peaked at 1.0px of crown travel per
   * 40ms frame across 27.3px of loop travel; this one peaks at 3.2 across 40.3.
   */
  idle: (t, e) => {
    const shift = env(t, 0.10, 0.14, 0.22, 0.2)
    const look = env(t, 0.40, 0.24, 0.16, 0.45)
    const sniff = env(t, 0.76, 0.08, 0.3, 0.12)
    const gate = Math.max(0, 1 - 2.2 * Math.max(shift, look, sniff))
    const flick = e.ear[0]
    return {
      torso: {
        ...breathe(t, 0.015),
        dx: 3.6 * shift - 1.2 * look,
        dy: heart(t, 8, gate) + 2.8 * sniff,
        angle: 2.6 * shift + 2.2 * look - 1.6 * sniff + 0.9 * snoise(t + 0.62) * (0.5 + 0.5 * gate),
      },
      head: {
        dy: 1.6 * snoise(t * 2 + 0.3) - 4.2 * sniff * (0.72 + 0.28 * Math.sin(TAU * 4 * t)) + 1.2 * look,
        angle: 4.2 * look - 1.8 * shift - 3 * sniff + flick * 0.16,
        perk: flick * 0.05 + 0.3 * look,
      },
    }
  },
  /**
   * Waiting on an answer: the lying body, awake. The same drawing sleep uses with the lids
   * up, so the state change costs nothing and the dog reads as settled rather than parked.
   * The breath is shallower and quicker than the sleeping one, and once a loop the whole
   * body lifts a little off the belly — the lying rig has one bone, so attention is a turn
   * of the body and not a movement of the head. The blinks are the state's own signal.
   */
  waiting: (t, e) => {
    const glance = env(t, 0.58, 0.16, 0.3, 0.34)
    return {
      torso: {
        ...breathe(t, 0.02 + 0.007 * snoise(t + 0.53)),
        angle: 0.26 * e.ear[0] + 1.5 * glance,
        dx: 0.16 * e.ear[0],
        dy: -2.2 * glance,
      },
    }
  },
  /**
   * Running a command: the same machine, and a dog that has stopped being pleased about it.
   * The brows come down toward the nose and the lids hold nearly half over the eyes, which
   * is what a downward look is from the front — the pupil stays where the art put it, so
   * covering its top is the same as aiming it at the desk. The ears come forward, the head
   * drops to the level the screen is at, and the breath goes shallow. Then it stops: one
   * long beat with nothing moving at all while the output comes back, which is the only
   * thing that separates watching a program run from typing without one.
   */
  working_command: (t, e) => {
    const { strike, side, lean: tapLean, reach } = shoulders(e.tap)
    const read = env(t, 0.46, 0.26, 0.12, 0.76)
    const lean = env(t, 0.06, 0.22, 0.4, 0.3)
    const gate = Math.max(0, 1 - 2.4 * Math.max(read, lean))
    const flick = e.ear[0]
    return {
      blink: 0.26 + 0.14 * read,
      brow: 1,
      torso: {
        ...breathe(t, 0.009 + 0.004 * snoise(t + 0.2)),
        dy: 1.6 * lean + heart(t, 4, gate) * (1 - read) + 1 * reach,
        dx: 0.7 * snoise(t * 2 + 0.5) * gate + 1.2 * tapLean,
        sx: 1 + 0.006 * strike,
        sy: 1 - 0.011 * strike,
        angle: 1.4 + 1.5 * lean - 1.2 * read + 0.5 * snoise(t * 2 + 0.15) * gate + 2.8 * side,
      },
      head: {
        dy: 8.5 + 1.5 * lean - 1.5 * read + 0.3 * heart(t, 4, gate),
        angle: 1.1 * snoise(t + 0.7) * gate,
        perk: 0.5 + 0.3 * lean - 0.15 * read + 0.04 * flick,
      },
    }
  },
  /**
   * The state's own read is a permanent body lean; the life is the head changing its
   * mind — one held attitude, then another — plus a paw tap and the flicks, all on
   * different clocks. The previous bake peaked at 1.0px per frame across 16.8px of travel;
   * this one at 1.6 across 24.5.
   */
  thinking: (t, e) => {
    const reconsider = env(t, 0.30, 0.30, 0.18, 0.4)
    const tap = env(t, 0.72, 0.10, 0.3, 0.12)
    const gate = Math.max(0, 1 - 2 * Math.max(reconsider, tap))
    const flick = e.ear[0]
    return {
      torso: {
        ...breathe(t, 0.012),
        dx: 1.6 * snoise(t + 0.1) * (0.5 + 0.5 * gate) + 1.2 * reconsider,
        angle: 2.8 + 1.4 * reconsider + 0.6 * snoise(t + 0.5) * gate,
        dy: heart(t, 7, gate) + 1.2 * reconsider,
      },
      head: {
        dy: -1 - 1.4 * reconsider + 0.5 * heart(t, 7, gate),
        angle: 4 - 2.6 * reconsider + flick * 0.2,
        perk: -0.15 + 0.4 * reconsider + 0.05 * flick,
      },
      paw: pawRaise(0.4 * tap),
    }
  },
  /**
   * The paws carry the state; the body answers rather than mirrors — a weight dip
   * under the tapping and two head accents (read the screen, peek at the paws) on
   * their own schedule, so the parts never lock step. The old bake moved everything
   * on one sine with no still frame: the previous bake peaked at 2.0px per frame across
   * 30.7px.
   */
  working: (t, e) => {
    const { strike, side, lean, reach } = shoulders(e.tap)
    const read = env(t, 0.18, 0.20, 0.25, 0.5)
    const peek = env(t, 0.66, 0.12, 0.3, 0.2)
    const gate = Math.max(0, 1 - 2 * Math.max(read, peek))
    const flick = e.ear[0]
    return {
      torso: {
        ...breathe(t, 0.018),
        // Each strike presses that shoulder down and rolls the body onto it, so the two
        // sides alternate rather than the whole body bouncing; the head springs below take
        // the opposite correction, which is what keeps the eyes on the screen while the
        // shoulders work.
        dy: heart(t, 5, gate) + 1.6 * Math.max(read, peek) + 0.9 * reach,
        sx: 1 + 0.005 * strike,
        sy: 1 - 0.010 * strike,
        dx: 1.2 * snoise(t + 0.6) * gate + 1.1 * lean,
        angle: 1.2 * read + 0.8 * peek + 0.8 * snoise(t * 2 + 0.25) * gate + 2.6 * side,
      },
      head: {
        dy: 5 - 3.5 * read + 2.2 * peek + 0.4 * heart(t, 5, gate),
        angle: 4 - 3 * read + 1.5 * peek + flick * 0.15,
        perk: -0.4 + 0.5 * read + 0.04 * flick,
      },
    }
  },
  /**
   * Two keyframed hops per loop (`hop`), each with its own crouch, stretched launch,
   * landing squash and settle wag; the head and mouth read the hop's phase gates.
   * The old bake rode one sine — airborne half the loop with no crouch and an
   * identical hop every time.
   */
  /** Two hops, each answered with a bark as it lands: the jaw opens, the head snaps back
   *  and up, and the body gives a push under it. A hop without a voice reads as exercise. */
  success: (t) => {
    const h = hop((t * 2) % 1)
    const settle = 1 - Math.max(h.air, h.squash, h.crouch)
    const wag = Math.sin(TAU * 4 * t)
    const bark = env(t, 0.26, 0.11, 0.22, 0.2) + env(t, 0.77, 0.11, 0.22, 0.2)
    return {
      torso: { sx: h.sx * (1 - 0.012 * bark), sy: h.sy * (1 + 0.02 * bark), dy: h.dy - 2.4 * bark, angle: 2.4 * wag * settle },
      head: { dy: -2.5 * h.air + 2.2 * h.squash + 1.5 * h.crouch - 3 * bark, angle: -5 * h.air + 2 * h.squash - 2.4 * bark, perk: 0.8 + 0.5 * h.air - 0.4 * h.squash + 0.3 * bark },
      mouth: Math.max(0.75 + 0.25 * h.air, bark),
    }
  },
  /**
   * Deflated is the state; the sigh is the event — one deeper exhale per loop — then
   * the ears try once to lift and give back. Between the two, only breath and tremor.
   */
  /** Deflated: the body sinks and lists, and once per loop it lifts its head just enough
   *  to let out a whimper — mouth barely open, ears still down — before it drops back.
   *  A slump with no voice is a statue, not a sad dog. */
  /**
   * Something went wrong, and the dog is dazed by it: the swirl eyes and the sway of being
   * shaken, carried on the droop of having failed. The ears stay back and the head stays
   * low, which is what separates it from `dragging_dizzy` — that one is upright and rocked
   * by someone else, this one is sinking under its own weight while the room turns. The
   * swirl turns twice a loop rather than the drag's three: slower reads as woozy rather
   * than as giddy, and twice is a whole number, so the eyes are where they started when the
   * clip wraps.
   */
  error: (t, e) => {
    const sigh = env(t, 0.34, 0.26, 0.25, 0.15)
    const whimper = env(t, 0.56, 0.13, 0.3, 0.12)
    const gate = Math.max(0, 1 - 2.2 * Math.max(sigh, whimper))
    const sway = snoise(t * 2)
    // The crouch has to be the body's doing: the head's own travel is bounded by the neck
    // seam (two and a half degrees, four pixels), so a droop asked of the head is clamped
    // away and the dog ends up upright. Sinking and widening the torso is what reads.
    return {
      torso: {
        sx: 1.045 + 0.012 * sigh,
        sy: 0.936 - 0.018 * sigh + 0.004 * bwave(t) * gate,
        dx: 3.4 * sway,
        dy: 7 + 2.4 * sigh - 1.2 * whimper + 0.7 * heart(t, 7, gate),
        angle: -2.2 - 1.2 * sigh + 1.6 * whimper + 2.2 * sway,
      },
      head: {
        dy: 4 + 2.6 * sigh - 3.4 * whimper,
        angle: -2.4 - 2.4 * snoise(t * 2 - 0.3),
        perk: -1.15 + 0.25 * snoise(t * 3) - 0.05 * whimper,
      },
      mouth: 0.34 * whimper + 0.2,
      spin: TAU * 2 * t,
      dizzy: 1,
    }
  },
  /** Dragged: the jostle is the state, but it braces once per loop against the pull. */
  dragging: (t, e) => {
    const brace = env(t, 0.30, 0.14, 0.3, 0.35)
    const gate = 1 - 1.8 * brace
    return {
      torso: {
        ...breathe(t, 0.014),
        dx: 4.5 * snoise(t * 2 + 0.3) * gate + 3 * brace,
        dy: 2 * snoise(t * 3) * gate + 1.5 * brace,
        angle: (-6 + 2.5 * snoise(t * 2)) * gate + 2 * brace,
      },
      head: { dy: 1.5, angle: 4 + 2 * snoise(t * 2 + 0.8) * gate, perk: -0.7 + e.ear[0] * 0.02 },
    }
  },
  dragging_release: (t) => {
    const s = Math.exp(-4.5 * t) * Math.cos(TAU * 2.6 * t)
    return {
      torso: { sy: 1 + 0.03 * s, dy: -13 * Math.exp(-6 * t) * Math.max(0, Math.sin(TAU * 1.3 * t)), angle: 3.5 * s },
      head: { dy: 6 * s, angle: 4 * s, perk: -0.8 * s },
    }
  },
  dragging_dizzy: (t) => ({
    torso: { ...breathe(t, 0.014), dx: 9 * snoise(t * 2), angle: 5.5 * snoise(t * 2 + 0.4) },
    head: { angle: -5 * snoise(t * 2 - 0.3), dy: 2, perk: 0.2 + 0.35 * snoise(t * 3) },
    // Three whole turns of the swirl per loop, so the eyes are where they started when the
    // clip wraps.
    spin: TAU * 3 * t, dizzy: 1,
    mouth: 0.35,
  }),
  dragging_protest: (t) => ({
    torso: { ...breathe(t, 0.02), dx: 10 * snoise(t * 3), angle: -5 + 2.5 * snoise(t * 3 + 0.2) },
    head: { angle: 5 + 2.5 * snoise(t * 3), dy: 2, perk: -0.85 },
  }),
  head_pat: (t) => {
    const p = pulse(t, 0.18, 0.25)
    const bob = Math.sin(TAU * 3 * t)
    const first = lick(t, 0.48, 0.26), second = lick(t, 0.79, 0.26)
    const out = Math.max(first.e, second.e)
    const head = first.e >= second.e ? first.whip * first.e : second.whip * second.e
    return {
      torso: { sy: 1 - 0.035 * p * Math.max(0, bob), dy: 3 * p * Math.max(0, bob), angle: 2.2 * p * snoise(t * 4) },
      // The muzzle dips and the ears sag as the tongue reaches up over the nose.
      head: { dy: 5 * p * bob + 1.6 * out, angle: -4 * p + 3 * p * bob, perk: 0.45 * p + 0.4 * p * bob - 0.25 * out },
      mouth: 0.75 * p, blink: t > 0.3 && t < 0.55 ? 1 : 0,
      lick: out, whip: head,
    }
  },
  /** A poke lands after a beat: the flinch is preceded by a coil that holds a few
   *  frames, because a reaction that starts at full speed reads as a playback, not
   *  a startle. */
  poke: (t) => {
    const coil = env(t, 0.02, 0.13, 0.35, 0.3)
    const d = Math.max(0, t - 0.16)
    const s = Math.exp(-6 * d) * Math.cos(TAU * 3 * d)
    return {
      torso: { sy: 1 - 0.016 * coil - 0.04 * s, dy: 2.2 * coil - 8 * Math.exp(-9 * d), angle: 2.5 * s },
      head: { dy: 1.8 * coil - 6 * Math.exp(-8 * d), angle: -5 * s, perk: 0.9 * Math.exp(-5 * d) },
    }
  },
  /** The tail wind-up: the body coils against the first swing — a wag starts from
   *  the shoulders, not from a standing start. */
  tail: (t) => {
    const coil = env(t, 0.02, 0.09, 0.55, 0)
    const w = Math.sin(TAU * 3 * t)
    return {
      torso: { ...breathe(t, 0.014), dx: 2.4 * w - 2 * coil, dy: 1.2 * Math.abs(w) + 0.9 * coil, angle: 2.8 * w - 2.2 * coil },
      head: { angle: -3.5 * w, dy: -1.5 * Math.abs(w) + 1.2 * coil, perk: 0.35 + 0.3 * w },
      mouth: 0.55,
    }
  },
  /** Pecking at a treat: each peck is a take-and-hold gesture with a lift before it,
   *  so the dog visibly resets and aims — a sine peck has nothing before it that reads as
   *  preparation. */
  eat_token: (t) => {
    const peck = env(t, 0.22, 0.15, 0.32, 0.12) + env(t, 0.50, 0.15, 0.32, 0.12) + env(t, 0.78, 0.15, 0.32, 0.12)
    const lift = env(t, 0.05, 0.13, 0.5, 0.1) + env(t, 0.40, 0.09, 0.5, 0) + env(t, 0.68, 0.09, 0.5, 0)
    return {
      torso: { ...breathe(t, 0.012), sx: 1 + 0.03 * peck - 0.01 * lift, sy: 1 - 0.058 * peck + 0.016 * lift, dy: 2.2 * peck - 1.8 * lift, angle: 1.8 * peck - 1.4 * lift },
      head: { dy: 6.5 * peck - 3.4 * lift, angle: 3.2 * peck - 2.2 * lift, perk: -0.5 * peck + 0.3 * lift },
      mouth: 0.9 * Math.min(1, peck),
    }
  },
  /** A look that arrives, is kept, and is given back — the old ramp had no hold, so
   *  the glance never read as looking at something. The counter-lean before the turn
   *  is the head's own wind-up against it. */
  glance: (t) => {
    const turn = env(t, 0.10, 0.64, 0.2, 0.38)
    const coil = env(t, 0.015, 0.09, 0.5, 0.1)
    return {
      torso: { ...breathe(t, 0.012), angle: 5.5 * turn - 2.6 * coil, dy: 1.2 * turn },
      head: { angle: 3.5 * turn - 1.8 * coil, dy: 1.5 * snoise(t), perk: 0.25 * turn },
    }
  },
  look_left: (t) => ({
    torso: { ...breathe(t, 0.012), angle: -3.6 + 0.8 * snoise(t + 0.3), dy: 0.6 },
    head: { angle: -3, dy: 1, perk: 0.3 },
    paw: pawRaise(0.55, 0.2 * snoise(t * 2)),
  }),
  look_right: (t) => ({
    torso: { ...breathe(t, 0.012), angle: 3.6 + 0.8 * snoise(t + 0.3), dy: 0.6 },
    head: { angle: 3, dy: 1, perk: 0.3 },
    paw: pawRaise(0.55, 0.2 * snoise(t * 2)),
  }),
  look_up: (t) => ({
    torso: { ...breathe(t, 0.012), sx: 0.992, sy: 1.016, angle: 0.8 * snoise(t + 0.4) },
    head: { dy: -6, angle: -2, perk: 0.65 },
    paw: pawRaise(0.5, 0.2 * snoise(t * 2 + 0.5)),
  }),
  look_down: (t) => ({
    torso: { ...breathe(t, 0.012), sx: 1.008, sy: 0.984, angle: -0.8 * snoise(t + 0.4) },
    head: { dy: 6, angle: 2, perk: -0.35 },
    paw: pawRaise(0.4, 0.2 * snoise(t * 2 + 0.5)),
  }),
  /** The paw presses down before it lifts — the weight transfer a real wave starts
   *  with — and the head leans into the press before it carries the greeting. */
  wave: (t) => {
    const pre = env(t, 0.06, 0.12, 0.45, 0.12)
    const p = pulse(t, 0.24, 0.28)
    const swing = Math.sin(TAU * 2.4 * t)
    return {
      torso: { ...breathe(t, 0.016), dx: 1.5 * snoise(t), dy: 1.2 * pre, angle: 2.6 * p * swing },
      head: { angle: -6 * p + 2 * p * swing + 1.6 * pre, dy: -2 * p + 1.4 * pre, perk: 0.7 * p },
      paw: pawRaise(-0.45 * pre + p, p * swing),
      mouth: 0.9 * p, blink: t > 0.45 && t < 0.6 ? 1 : 0,
    }
  },
  /** Lifting a touched paw out from under the hand and looking at it: the paw presses
   *  into the hand before it leaves it, and the head dips before it follows the paw up. */
  paw_offer: (t) => {
    const pre = env(t, 0.05, 0.13, 0.45, 0.15)
    const p = pulse(t, 0.22, 0.26)
    return {
      torso: { ...breathe(t, 0.012), sx: 1 - 0.01 * pre, dy: 1.5 * p + 1.8 * pre, angle: -1.6 * p },
      head: { angle: -4 * p + 1.4 * pre, dy: -1.5 * p + 2.6 * pre, perk: 0.5 * p },
      paw: pawRaise(-0.4 * pre + p),
      mouth: 0.35 * p,
    }
  },
  /**
   * Asleep on the desk. The lying body is one piece, so its life is a breath slower and
   * deeper than the idle one, the sigh at the top of every third breath, and the dream
   * twitch the spring delivers — no joint moves here because there are no joints. The lids
   * stay down: the master is drawn awake, and this is what makes it asleep.
   */
  sleep: (t, e) => {
    const sigh = Math.pow(Math.max(0, Math.sin(TAU * 3 * t)), 8)
    return {
      blink: 1,
      torso: {
        ...breathe(t, 0.034 + 0.012 * snoise(t + 0.31)),
        angle: 0.22 * e.ear[0] + 0.3 * sigh,
        dx: 0.12 * e.ear[0],
        dy: -1.6 * sigh,
      },
    }
  },
}
const CLIPS = {
  idle: { frames: 96, frameMs: 40 },
  waiting: { frames: 90, frameMs: 60, loop: true, rig: 'lying' },
  thinking: { frames: 88, frameMs: 40 },
  working: { frames: 64, frameMs: 40, type: true },
  working_command: { frames: 64, frameMs: 36, type: true, pose: 'working_command', rest: [0.46, 0.72] },
  success: { frames: 60, frameMs: 36, spring: { k: 220, zeta: 0.55, kLift: 240, zetaLift: 0.6 } },
  error: { frames: 80, frameMs: 44 },
  dragging: { frames: 48, frameMs: 36 },
  dragging_release: { frames: 24, frameMs: 34, loop: false },
  dragging_dizzy: { frames: 64, frameMs: 36 },
  dragging_protest: { frames: 44, frameMs: 36, turn: { front: 'sitting', back: 'back' } },
  head_pat: { frames: 48, frameMs: 40, loop: false },
  poke: { frames: 24, frameMs: 36, loop: false },
  paw_offer: { frames: 34, frameMs: 42, loop: false },
  tail: { frames: 34, frameMs: 40, loop: false },
  eat_token: { frames: 40, frameMs: 40, loop: false },
  glance: { frames: 56, frameMs: 50, loop: false },
  look_left: { frames: 24, frameMs: 55 },
  look_right: { frames: 24, frameMs: 55 },
  look_up: { frames: 24, frameMs: 55 },
  look_down: { frames: 24, frameMs: 55 },
  wave: { frames: 44, frameMs: 50, loop: false },
  sleep: { frames: 90, frameMs: 80, loop: true, rig: 'lying', bubbles: true },
  lie_down: { frames: 26, frameMs: 36, loop: false, bridge: 'lie_down' },
  wake_up: { frames: 26, frameMs: 34, loop: false, bridge: 'wake_up' },
}

const STATE_MAP = {
  IDLE: 'idle', THINKING: 'thinking', WORKING: 'working', WAITING: 'waiting',
  SUCCESS: 'success', ERROR: 'error', DISCONNECTED: 'idle',
}
const WORKING_ACTIVITY_MAP = {
  searching: 'working', commanding: 'working_command', editing: 'working',
  testing: 'working_command', 'using-tool': 'working',
}
const IDLE_MICRO_CLIPS = ['glance', 'wave', 'tail', 'eat_token']

// --------------------------------------------------------------------- render

let byId = {}

function place(layer, m, opacity = 1) {
  return `<image href="${layer.href}" x="${layer.bx}" y="${layer.by}" width="${layer.bw}" height="${layer.bh}" transform="matrix(${fmt(m)})" preserveAspectRatio="none"${opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : ''}/>`
}

/**
 * @param head - a head channel.
 * @returns it with the travel the neck seam can carry. The seam crosses the silhouette
 * at the neck's waist, where the outline is vertical: sideways travel steps the head off
 * it, and travel along it costs the outline its deviation from straight over that travel,
 * which at the waist is the square of the slide divided by the neck's radius of curvature
 * (4.5px on the master). Four pixels of rise therefore costs under one pixel of outline
 * and eight costs over seven, so rotation stays small and the pose reads through the bob,
 * the perk, and the body beneath it.
 */
function clampHead(head) {
  const lim = (v, n) => Math.max(-n, Math.min(n, v))
  return { ...head, angle: lim(head.angle ?? 0, 2.5), dx: lim(head.dx ?? 0, 0), dy: lim(head.dy ?? 0, 4) }
}

/** Resolve the joint hierarchy into a world matrix per bone, for the bones this rig has. */
function worldMatrices(pose, bones = byId) {
  const ch = (o) => o ?? {}
  const torso = ch(pose.torso)
  const torsoWorld = mul(
    mul(about(bones.torso.pivot, rotate(torso.angle ?? 0)), about(bones.torso.pivot, scale(torso.sx ?? 1, torso.sy ?? 1))),
    translate((torso.dx ?? 0) * SS, (torso.dy ?? 0) * SS),
  )
  const out = { torso: torsoWorld }
  // The sleep rig has no head and no paw: the lying dog is one piece.
  if (bones.head !== undefined) {
    // The head's outline is the silhouette above the seam, so every extra degree swings a
    // wide part of the cheek past the body that should cover it. Poses ask for what reads
    // best; this is what the cut tolerates.
    const head = clampHead(ch(pose.head))
    // A perk stretches the head and its ears upward from the neck, the way a dog squares
    // up to listen; a sag does the reverse.
    const perk = scale(1 - 0.25 * PERK * (head.perk ?? 0), 1 + PERK * (head.perk ?? 0))
    const headOwn = mul(mul(about(bones.head.pivot, rotate(head.angle ?? 0)), about(bones.head.pivot, perk)), translate((head.dx ?? 0) * SS, (head.dy ?? 0) * SS))
    out.head = mul(torsoWorld, headOwn)
  }
  if (bones.paw !== undefined) {
    out.paw = mul(torsoWorld, mul(about(bones.paw.pivot, rotate(ch(pose.paw).angle ?? 0)), translate((ch(pose.paw).dx ?? 0) * SS, (ch(pose.paw).dy ?? 0) * SS)))
  }
  return out
}

async function render(name, body) {
  byId = body.byId
  const { rig, eyes, nose } = body
  const clip = CLIPS[name]
  const poseName = clip.pose ?? name
  const poseFn = POSES[poseName]
  if (poseFn === undefined) throw new Error(`no pose for clip "${name}"`)
  const outDir = join(OUT_ROOT, name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const seed = seedOf(name)
  const perkAmp = { idle: 7, waiting: 6, thinking: 5, working: 6, error: 4, dragging: 10 }[poseName] ?? 8
  const looping = clip.loop !== false
  const flick = springAngles(clip.frames, clip.frameMs, seed, { amp: perkAmp, loop: looping })
  const jitter = rng(seed)()
  const blinkAts = looping ? [0.3 + jitter * 0.16, 0.66 + jitter * 0.18].filter(a => a < 0.95) : []
  const sched = clip.type === true ? typingSchedule(clip.frames, seed, clip.rest) : null
  const order = body.order
  const dt = clip.frameMs / 1000
  // A one-shot is held on its last frame until it hands back to the clip underneath, so
  // its last frame must be a rest frame: sampling through `t = 1` lands the cycles there.
  // A loop must not sample its own endpoint, or every cycle repeats the first frame twice.
  const at = (i) => i / (looping ? clip.frames : clip.frames - 1)
  // `tap` is which paw struck on this frame and which is coming back down. The paws are on
  // the far side of the laptop's shell and cannot be seen, so the pose takes the signal and
  // spends it on the shoulders that reach them.
  const none = { lift: 0, slide: 0 }
  const poses = Array.from({ length: clip.frames }, (_, i) => poseFn(at(i), {
    ear: [flick[i], flick[i]],
    tap: sched === null ? { L: none, R: none } : { L: sched.L[i], R: sched.R[i] },
  }))
  // The body answers a lean or a lift through a spring, and the head takes that spring's
  // error the other way: it is left behind as the body starts and catches up as it stops.
  // Both bones ride the torso matrix, so this secondary motion costs the neck seam nothing,
  // which is more than the head's own travel can say.
  const asked = (p, key) => p.torso?.[key] ?? 0
  // A clip can stiffen the body springs when its pose is already choreographed in
  // phases (`spring`): the general spring exists to round metronome requests, and a
  // keyframed hop needs to keep its crouch and landing.
  const bodySpring = clip.spring ?? {}
  const lean = springFollow(poses.map((p) => asked(p, 'angle')), dt, { k: bodySpring.k ?? 90, zeta: bodySpring.zeta ?? 0.45, loop: looping })
  const lift = springFollow(poses.map((p) => asked(p, 'dy')), dt, { k: bodySpring.kLift ?? 120, zeta: bodySpring.zetaLift ?? 0.6, loop: looping })
  if (!looping) {
    // A spring asked to stop is still moving when the clip runs out, and a one-shot is held
    // on that last frame before it hands back. Blend the spring onto its target over the
    // tail so the frame the next clip inherits is the rest frame.
    const tail = Math.max(2, Math.round(clip.frames * 0.2))
    const blendTail = (spring, req) => {
      for (let i = clip.frames - tail; i < clip.frames; i++) {
        const w = (i - (clip.frames - tail)) / tail
        spring[i] += (req[i] - spring[i]) * w
      }
    }
    blendTail(lean, poses.map((p) => asked(p, 'angle')))
    blendTail(lift, poses.map((p) => asked(p, 'dy')))
  }
  // The head runs its own springs on top of the body's lag: a pose request that arrives
  // frame-for-frame reads as scripted, while the same request through a softer spring
  // overshoots and settles, so gestures carry follow-through. The lag correction below
  // is what the body's spring hands the head; the head's spring is the head's own
  // inertia on top of it. `clampHead` still bounds whatever the overshoot sums to.
  const tiltReq = [], dipReq = []
  for (let i = 0; i < clip.frames; i++) {
    const pose = poses[i]
    const lag = lean[i] - asked(pose, 'angle'), rise = lift[i] - asked(pose, 'dy')
    pose.torso = { ...pose.torso, angle: lean[i], dy: lift[i] }
    tiltReq.push((pose.head?.angle ?? 0) - 1.1 * lag - 0.45 * rise)
    dipReq.push((pose.head?.dy ?? 0) - 1.5 * rise - 1.8 * lag)
  }
  const headLean = springFollow(tiltReq, dt, { k: 110, zeta: 0.5, loop: looping })
  const headDip = springFollow(dipReq, dt, { k: 130, zeta: 0.55, loop: looping })
  if (!looping) {
    const tail = Math.max(2, Math.round(clip.frames * 0.2))
    for (let i = clip.frames - tail; i < clip.frames; i++) {
      const w = (i - (clip.frames - tail)) / tail
      headLean[i] += (tiltReq[i] - headLean[i]) * w
      headDip[i] += (dipReq[i] - headDip[i]) * w
    }
  }
  for (let i = 0; i < clip.frames; i++) {
    const t = at(i)
    const pose = poses[i]
    pose.head = { ...pose.head, angle: headLean[i], dy: headDip[i] }
    const blink = Math.max(0, ...blinkAts.map(a => blinkAmount(t, a)), pose.blink ?? 0)
    const m = worldMatrices(pose)
    const parts = order.map(l => place(l, m[l.id]))
    const face = rig.face ? faceSvg(eyes, nose, { ...pose, blink }) : ''
    // The lying body has no neck joint to carry the face, so the lids ride the torso.
    if (face !== '') parts.push(`<g transform="matrix(${fmt(m.head ?? m.torso)}) scale(${SS})">${face}</g>`)
    // The laptop is a thing on the desk, not part of the dog: it stays put while the body
    // leans over it and the shoulders rock.
    if (sched !== null) parts.push(`<g transform="scale(${SS})">${typingSvg()}</g>`)
    if (clip.bubbles === true) parts.push(`<g transform="matrix(${fmt(m.torso)}) scale(${SS})">${bubblesSvg(t)}</g>`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`
    const buf = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer()
    writeFileSync(join(outDir, `${name}_${String(i + 1).padStart(3, '0')}.webp`), buf)
  }
  console.log(`${name}: ${clip.frames} frames (${clip.frameMs}ms)`)
}

/**
 * Bridge the sitting and the lying body, in either direction.
 *
 * Lying down and getting up are the two moments the skin cannot reach with joints: the
 * dog on the desk is a different drawing from the dog sitting up, and a short crossfade
 * between them reads as the animal dissolving. So the bridge travels through a shape both
 * drawings can hold. The sitting body squashes toward the desk — 30% of its height, 24%
 * more width, head down and eyes closing — and the lying body rises to meet it, stretched
 * taller and narrower than its rest. Where those two outlines agree is the middle of the
 * clip, and that is where the dissolve sits, under the fastest motion. `u` runs 0 at
 * sitting rest to 1 at lying rest, so the first frame is the sitting master and the last
 * is the lying one: the clips they hand over to begin at the same drawing, and the state
 * change has no seam at either end.
 *
 * @param name - the bridge clip's name.
 * @param bodies - the cut rigs, keyed by `RIGS`.
 */
async function renderBridge(name, bodies) {
  const clip = CLIPS[name]
  const lying = clip.bridge === 'lie_down'
  const sit = bodies.sitting, rest = bodies.lying
  const outDir = join(OUT_ROOT, name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const smooth = (x) => x * x * (3 - 2 * x)
  const span = (x, lo, hi) => smooth(Math.max(0, Math.min(1, (x - lo) / (hi - lo))))
  for (let i = 0; i < clip.frames; i++) {
    const eased = smooth(i / (clip.frames - 1))
    const u = lying ? eased : 1 - eased
    // The squash finishes before the dissolve starts, so the two drawings trade places
    // while they hold the same low, wide shape rather than while one is still upright.
    const down = span(u, 0, 0.42)
    const shown = span(u, 0.38, 0.60)
    const settle = 1 - span(u, 0.55, 1)
    const sitPose = {
      torso: { sx: 1 + 0.38 * down, sy: 1 - 0.34 * down, angle: 4 * down },
      head: { dy: 6 * down, perk: -0.9 * down },
      blink: down,
    }
    const restPose = { torso: { sx: 1 - 0.08 * settle, sy: 1 + 0.12 * settle } }
    byId = sit.byId
    const ms = worldMatrices(sitPose, sit.byId)
    const mr = worldMatrices(restPose, rest.byId)
    const parts = sit.order.map(l => place(l, ms[l.id], 1 - shown))
    const face = faceSvg(sit.eyes, sit.nose, sitPose, 's')
    if (shown < 1 && face !== '') parts.push(`<g transform="matrix(${fmt(ms.head)}) scale(${SS})" opacity="${(1 - shown).toFixed(3)}">${face}</g>`)
    parts.push(...rest.order.map(l => place(l, mr[l.id], shown)))
    // The lying master is drawn awake, so the body rising into a sitting one has to be
    // given its lids by the same driver that closes the sitting dog's eyes on the way down:
    // the two drawings are then both shut where the dissolve happens, and the clip that
    // hands over to `sleep` ends with the eyes already closed.
    const restFace = faceSvg(rest.eyes, rest.nose, { blink: down }, 'r')
    if (shown > 0 && restFace !== '') parts.push(`<g transform="matrix(${fmt(mr.torso)}) scale(${SS})" opacity="${shown.toFixed(3)}">${restFace}</g>`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`
    const buf = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer()
    writeFileSync(join(outDir, `${name}_${String(i + 1).padStart(3, '0')}.webp`), buf)
  }
  console.log(`${name}: ${clip.frames} frames (${clip.frameMs}ms)`)
}

/**
 * Turn the dog around its own vertical axis, in protest.
 *
 * A turn is the one action the rig can express honestly as a projection: the silhouette
 * narrows as the body rotates away, and the frame where it has no width left is exactly
 * where the front drawing is replaced by the one seen from behind — so the swap is
 * invisible rather than a dissolve between two shapes. Both masters stand on the same axis
 * and the same baseline, so the feet and the center never move, and the lean is symmetric
 * about the swap so nothing steps between the two bodies.
 *
 * @param name - the clip's name.
 * @param bodies - the cut rigs, keyed by `RIGS`.
 */
async function renderTurn(name, bodies) {
  const clip = CLIPS[name]
  const front = bodies[clip.turn.front], back = bodies[clip.turn.back]
  const outDir = join(OUT_ROOT, name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const smooth = (x) => x * x * (3 - 2 * x)
  const clamp01 = (x) => Math.max(0, Math.min(1, x))
  // The turn is counted in frames, not in fractions of the clip: the frame where the body is
  // edge-on is where the drawing swaps, and if that moment falls between two frames the
  // width jumps from a sliver to a full back view in one step. Nine frames per quarter turn
  // puts it on frame 8 exactly.
  const quarter = 9
  const total = clip.frames
  for (let i = 0; i < total; i++) {
    const back_ = i >= total - quarter * 2
    const k = back_ ? total - 1 - i : i
    let facing
    if (k < quarter) facing = 0.5 * smooth(k / (quarter - 1))
    else if (k < quarter * 2) facing = 0.5 + 0.5 * smooth((k - quarter + 1) / (quarter - 1))
    else facing = 1
    const t = i / total
    const gate = facing >= 1 ? 1 : 0
    const yaw = Math.PI * facing + 0.13 * gate * Math.sin(TAU * 3 * t)
    const shown = Math.cos(yaw) < 0
    const body = shown ? back : front
    const width = Math.max(0.04, Math.abs(Math.cos(yaw)))
    byId = body.byId
    const pose = {
      torso: { sx: width, sy: 1 + 0.03 * (1 - width), angle: 2 * Math.sin(yaw) },
      head: { angle: 2.4 * Math.sin(yaw), perk: 0.35 * gate },
    }
    const m = worldMatrices(pose, body.byId)
    const parts = body.order.map(l => place(l, m[l.id]))
    const face = body.rig.face ? faceSvg(body.eyes, body.nose, pose) : ''
    if (face !== '') parts.push(`<g transform="matrix(${fmt(m.head)}) scale(${SS})">${face}</g>`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`
    const buf = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer()
    writeFileSync(join(outDir, `${name}_${String(i + 1).padStart(3, '0')}.webp`), buf)
  }
  console.log(`${name}: ${clip.frames} frames (${clip.frameMs}ms)`)
}

/**
 * @param dir - a clip's frame directory. @param files - its frame file names.
 * @returns the logical box the dog's own pixels occupy across a sample of the clip, as
 * `[x, y, width, height]` from the frame's top-left corner.
 */
async function bodyBox(dir, files) {
  const step = Math.max(1, Math.floor(files.length / 12))
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let i = 0; i < files.length; i += step) {
    const { data: px, info } = await sharp(join(dir, files[i])).raw().toBuffer({ resolveWithObject: true })
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (px[(y * info.width + x) * info.channels + 3] <= 8) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return [x0 / SS, y0 / SS, (x1 + 1 - x0) / SS, (y1 + 1 - y0) / SS].map(Math.round)
}

async function emitManifest() {
  const clips = {}
  for (const [name, clip] of Object.entries(CLIPS)) {
    const dir = join(OUT_ROOT, name)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.webp')).sort()
    if (files.length === 0) continue
    clips[name] = {
      frames: files.map(f => `${name}/${f}`), frameMs: clip.frameMs, loop: clip.loop ?? true,
      // Which drawing the clip stands on. A clip that carries no body is itself the move
      // from one to the other, so the helper never bridges into it.
      ...(clip.bridge === undefined && clip.turn === undefined ? { body: clip.rig ?? 'sitting' } : {}),
      bodyBox: await bodyBox(dir, files),
    }
  }
  const manifest = {
    formatVersion: 1, characterId: 'frenchie-doudou', baseSize: LOGICAL_WIDTH,
    maxFrameWidth: LOGICAL_WIDTH, maxFrameHeight: LOGICAL_HEIGHT, clips, stateMap: STATE_MAP,
    workingActivityMap: WORKING_ACTIVITY_MAP, idleMicroClips: IDLE_MICRO_CLIPS,
  }
  writeFileSync(join(HERE, 'pet-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`manifest: ${Object.keys(clips).length} clips`)
}

async function main() {
  const arg = process.argv[2]
  const diagnostic = arg === '--rest' || arg === '--layers'
  const wanted = diagnostic || arg === undefined || arg === 'all' ? Object.keys(CLIPS) : [arg]
  if (!diagnostic && wanted.some(n => CLIPS[n] === undefined)) { console.error(`no clip "${arg}"`); process.exit(1) }
  const bodies = {}
  for (const [rigName, rig] of Object.entries(RIGS)) {
    if (!existsSync(rig.master)) { console.error(`missing master: ${rig.master}`); process.exit(1) }
    const { layers, eyes, nose } = await buildLayers(rig, join(LAYER_DIR, rigName))
    const bones = {}
    for (const l of layers) { bones[l.id] = l; l.href = `data:image/png;base64,${l.png.toString('base64')}` }
    const body = { rig, eyes, nose, byId: bones, order: [...rig.bones].sort((a, b) => a.z - b.z).map(b => bones[b.id]) }
    bodies[rigName] = body
    if (!diagnostic) continue
    byId = bones
    if (arg === '--layers') {
      await sharp({ create: { width: WIDTH * 3, height: HEIGHT * 2, channels: 4, background: { r: 248, g: 246, b: 243, alpha: 1 } } })
        .composite(layers.map((l, i) => ({ input: l.png, left: (i % 3) * WIDTH, top: Math.floor(i / 3) * HEIGHT })))
        .png().toFile(`/tmp/rig-layers-${rigName}.png`)
      console.log(`wrote /tmp/rig-layers-${rigName}.png`)
      continue
    }
    const m = worldMatrices({})
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${body.order.map(l => place(l, m[l.id])).join('')}</svg>`
    const cut = await sharp(Buffer.from(svg)).png().toBuffer()
    const flat = (b) => sharp(b).flatten({ background: '#f8f6f3' })
    await flat(cut).composite([{ input: await flat(await sharp(rig.master).png().toBuffer()).toBuffer(), blend: 'difference' }])
      .modulate({ brightness: 8 }).png().toFile(`/tmp/rig-diff-${rigName}.png`)
    await sharp(cut).png().toFile(`/tmp/rig-rest-${rigName}.png`)
    console.log(`wrote /tmp/rig-rest-${rigName}.png and /tmp/rig-diff-${rigName}.png`)
  }
  if (!diagnostic) {
    for (const n of wanted) {
      const clip = CLIPS[n]
      if (clip.bridge !== undefined) await renderBridge(n, bodies)
      else if (clip.turn !== undefined) await renderTurn(n, bodies)
      else await render(n, bodies[clip.rig ?? 'sitting'])
    }
    await emitManifest()
  }
}
await main()
