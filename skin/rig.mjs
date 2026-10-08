// The frenchie rig: which pixels belong to which bone, and where each joint is.
//
// Every cut follows the master's own silhouette rather than a hand-traced outline, so
// a bone carries its full outline when it swings and leaves no orphan fragment on the
// layer beneath. `cut-preview.mjs` draws these lines over the art for placement and
// `mask-preview.mjs` shows which pixels each bone claims.
//
// Geometry is written in the clip's logical units and sampled at SS of those, because the
// helper draws a clip into a window of its logical size and a Retina display asks that
// window for twice as many device pixels as a 1x master can supply.
export const SS = 2
/** The size the helper lays the sprite out at. */
export const LOGICAL_WIDTH = 412
export const LOGICAL_HEIGHT = 344
/** The master's own axis: its silhouette spans columns 100..312. */
export const LOGICAL_CX = 206

export const WIDTH = LOGICAL_WIDTH * SS
export const HEIGHT = LOGICAL_HEIGHT * SS
export const CX = LOGICAL_CX

/** @param pts - polygon in logical units. @returns whether the logical point lies inside it. */
export function inPoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** @param pred - per-pixel test in logical units. @returns a 0/255 region over the master. */
export function grid(pred) {
  const m = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (pred(x / SS, y / SS)) m[y * WIDTH + x] = 255
  return m
}
export const only = (a, b) => a.map((v, i) => Math.min(v, b[i]))
/** @param v - a length or coordinate in logical units. @returns it in master pixels. */
export const dev = (v) => v * SS

/**
 * The paw bone: the front foot, bounded by the art's own leg lines.
 *
 * The master draws this foot between strokes at columns 229..237 and 262..276, and the
 * belly's underside comes in from the left to meet the outer stroke at (229, 322). The
 * bone starts at row 310, above where the two strokes end and the foot's own outline
 * begins: a cut across a drawn line leaves half of it behind, and the foot's vertical
 * strokes sliding against each other is invisible, so nothing shows at the joint.
 *
 * The bone must not reach left of those strokes. It used to start at column 204, which
 * is twenty-five pixels of belly, so turning the foot lifted the belly's outline off the
 * chest and dragged a loose stroke across it.
 */
export const PAW = [[232, 309], [267, 309], [272, 316], [278, 323], [278, 333], [224, 333], [224, 323], [228, 316]]
/** The wrist: the top of the foot, so a turn lifts the toes and a swing waves them. */
const PAW_PIVOT = [250, 311]
/**
 * The row the body's own underside runs along beside the leg: measured on the master, the
 * silhouette's bottom is row 319 to 322 from column 206 to 228, where the belly's line meets
 * the leg's outer stroke.
 *
 * The body keeps the paw's pixels down to this row and gives up only what hangs below it.
 * A paw that lifts takes the leg's lower half with it, and the master draws no underside
 * behind that leg, so the body was left with a flat cut of bare coat and its outline stopped
 * dead at the raised foot. Below this row the space is outside the body, so background there
 * is correct; the cut edge gets the master's own line.
 */
export const PAW_FLOOR = 320

/**
 * Chin line: the seam between head and body.
 *
 * The master's silhouette narrows from the cheeks to a waist at (±59, 191) and widens
 * again for the chest, so the waist is where the outline runs vertically. A seam that
 * crosses there lets the head slide along its own outline instead of stepping off it:
 * the ledge a joint leaves behind is the outline's deviation over the slide, and at the
 * waist that deviation is second order. Everywhere else the outline is a sloped ramp and
 * the same slide cuts a visible notch.
 *
 * Between the waist and the middle the line hugs the art's own jowl, staying six pixels
 * under it (measured on the master: the jowl runs 186 at ±58 down to 212 on the axis), so
 * the head keeps the whole mouth line and the body never copies it. On the axis the line
 * sits at 224, clear of the jowl's lowest ink at 212.
 */
const WAIST_Y = 191
const WAIST_HALF = 59
const JOWL_BOTTOM = 224
export const chinLine = (x) => {
  const u = Math.abs(x - LOGICAL_CX)
  if (u >= WAIST_HALF) return WAIST_Y
  return WAIST_Y + (JOWL_BOTTOM - WAIST_Y) * (1 - (u / WAIST_HALF) ** 2.3)
}
/** @param x - column. @returns the head's lower bound there. */
export const headBelow = chinLine
/**
 * How far the body reaches above the seam. The head's own cut is what ends its coverage,
 * so the ledge lands on the seam at the waist rather than on the body's upper edge; this
 * only has to exceed how far the head rises through the seam. Measured on the worst clip
 * (`head_pat`, a bobbing head at its full travel plus the lag the body's spring hands it),
 * the head's edge separates from the body by 11px, and 6 left a crescent of desktop
 * between the jowl and the shoulder.
 */
export const NECK_OVERLAP = 13
/**
 * The band the body carries above the seam is repainted with the body's own plain fur.
 * Copying the master there also copies the jowl's dark outline, and the moment the head
 * swings off it that copy stands out past the body's edge as a dark wedge — the wider the
 * overlap, the longer the wedge. The band's job is coverage, not drawing.
 *
 * The band ends at the seam and nowhere past it. Only rows above the seam are ever hidden
 * by the head, so a band that reaches below erases the body's own outline for the depth of
 * the overshoot and leaves the silhouette a bare stretch of coat — the outline reads as
 * separate strokes instead of one line. Measured on the rest frame, 5px of overshoot cost
 * rows 191 through 195 their line.
 * @param x - column in logical units. @returns the row whose color the column's band takes.
 */
export const neckFur = headBelow
/**
 * How far the master's own outline reaches in from the silhouette, in device pixels. Ink
 * this deep belongs to the line that draws the body's edge and survives the neck band;
 * anything further in is line work the band repaints. Measured on the sitting master
 * across the band's rows, the line runs nine to twelve pixels deep.
 */
export const OUTLINE_DEPTH = 12

/**
 * Layers in paint order.
 *
 * The ears ride the head: a cut through an ear's root either leaves outline behind on
 * the head or drags its own root across the crown, and no rotation small enough to hide
 * that is worth calling motion. Ear language lives in the head's perk.
 */
export const BONES = [
  {
    id: 'torso', z: 0, pivot: [dev(LOGICAL_CX), dev(332)],
    region: (g) => only(g.sil, grid((x, y) => y >= headBelow(x) - NECK_OVERLAP && (!inPoly(PAW, x, y) || y < PAW_FLOOR))),
    fur: neckFur,
    // Close the body's outline along the edge where the paw bone leaves.
    floor: PAW_FLOOR,
  },
  { id: 'head', z: 1, pivot: [dev(LOGICAL_CX), dev(WAIST_Y)], region: (g) => only(g.sil, grid((x, y) => y < headBelow(x))) },
  { id: 'paw', z: 2, pivot: [dev(PAW_PIVOT[0]), dev(PAW_PIVOT[1])], region: (g) => only(g.sil, grid((x, y) => inPoly(PAW, x, y))) },
]

/**
 * The lying rig: the lying dog is one piece.
 *
 * The lying pose rests its head on its own paws, so the contact between them is what
 * says "lying down" — a seam anywhere under the jaw breaks that contact instead of
 * bending it. Everything the lying clips ask for, a slow breath and a startle, the whole
 * body can carry, so the master is claimed whole and turns about the belly.
 */
export const SLEEP_BONES = [
  { id: 'torso', z: 0, pivot: [dev(LOGICAL_CX), dev(332)], region: (g) => g.sil },
]
/** Where the lying head is, so the rising Zs start beside the ear rather than on it. */
export const SLEEP_HEAD = [238, 182]
/**
 * The dog seen from behind, claimed whole: there is no face on it to animate, and a seam
 * would have nothing to express. Its axis and baseline are the sitting master's, so a turn
 * between the two keeps the feet and the center where they were.
 */
export const BACK_BONES = [
  { id: 'torso', z: 0, pivot: [dev(LOGICAL_CX), dev(332)], region: (g) => g.sil },
]

/** @param px - the master's raw RGBA pixels. @returns the pixels the bones are cut from. */
export function rigContext(px, channels) {
  const sil = new Uint8Array(WIDTH * HEIGHT)
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const a = px[i * channels + 3]
    // Any ink at all belongs to a bone; a stricter test would leave the master's soft
    // antialiased edge unclaimed and show as a fringe.
    sil[i] = a > 8 ? 255 : 0
  }
  return { sil }
}
