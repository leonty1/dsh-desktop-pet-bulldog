# Skin pipeline

Sprite frames for the French-bulldog desktop pet, in the format the `dsh-frenchie` native
helper reads: `pet-manifest.json` → `clips` → frame-by-frame `.webp`, logical 412×344,
uppercase `stateMap`.

## Rig pipeline

One master drives each body. `poses/idle.png` is a transparent, bottom-centered sitting
dog and `poses/lying.png` the same dog lying on the desktop with its head on its paws;
`rig.mjs` cuts a master into bones — for the sitting body, torso, head and one front paw —
each with a parent and a pivot, and `build-sprites.mjs` bakes a pose over that hierarchy
into the frame sequences. A clip names its body with `rig:`, defaulting to the sitting one,
because lying down is a different drawing rather than a pose over the sitting rig. Because
every state of a body is the same drawing with different joint angles, switching clips
cannot jump between differently drawn dogs.

The lying master is drawn awake. Waiting and sleeping are the same body with the lids in
different places, so one drawing serves both states and the clip between them, and the
eyes are an overlay the bake puts on rather than paint in the art. That means the bake has
to find the eyes on a dog whose head is off to one side: `face: { head: [x0, y0, x1, y1] }`
names the head box, and the anchors come from the dark ink either side of that box's axis
rather than of the silhouette's, which for a lying dog is somewhere down its back.

The master is `SS` (2) times the clip's logical size, 824×688 for a 412×344 clip. The
helper draws a clip into a window of its logical size, and a Retina display asks that
window for twice as many device pixels; a 1x master would be enlarged by the display
after every joint had already been resampled at 1x, which is what made the outline look
soft. All geometry in `rig.mjs` and in the face and laptop overlays is authored in
logical units and scaled once on the way out.

`prep-masters.mjs` gives every master after `idle` the sitting dog's palette, at 0.85 of
the remaining gap. A fresh generation of the same drawing arrives with its own cast: an
earlier lying art came back golden where the sitting dog is pale fawn, mean rgb(200,161,116)
against rgb(216,185,151), with no cream in the coat, so the two bodies read as two dogs.
Matching each channel's mean and spread is affine and leaves the drawing's own shading
alone; a full histogram match speckles flat fur, because the art's dither lands on the
reference cumulative curve's steep runs. The map is clamped to 0..255: the art's darkest ink
sits far enough below the reference's mean that the affine image goes negative, and a raw
`Buffer` wraps −16 to 240, which turned the lying dog's eyes blue.

The coat match cannot reach the outline, and the outline is a separate complaint: a fresh
generation can land on the sitting dog's coat and still be drawn with a different hand. The
sitting art is drawn with a thick dark line; the lying art's is thin, pale and uneven in
weight, and the back art leaves stretches of its rim unlined at all. Darkening a line cannot
make a thin one thick or a broken one continuous, so `restroke` draws the rim from the
reference instead: the reference's own width and color, painted inward from the silhouette
and faded out over its last three pixels so it meets the coat rather than stopping on it. The
shape does not move — only pixels already inside it are touched — and the sitting master,
which is the reference, is never redrawn.

Raw art arrives as a die-cut sticker: a band of near-white pixels hugging the character,
carrying a cast of the magenta it was cut against. Keying cannot name it (it is nowhere near
the background color) and the drawing's own highlights are just as white, so neither can
color alone. What separates them is that the flood only reaches the background: every color
in the dog is warm, so blue never reaches green, while the magenta ground and the band are
mixtures of magenta and white where blue sits above green, and the interior highlights are
enclosed by the outline and so unreachable. The band's innermost pixels have taken a little
of the coat, enough for blue to drop below green, and what still gives them away is that they
are nearly colorless and nearly white — no part of the drawing is — so the flood walks those
too. There is no second pass. An earlier one peeled any pixel touching the background that
was lighter than luminance 180, on the theory that only band could be light there; on the
lying art that ate the outline itself, whose antialiased edge answers the same test, and each
round took another row of a stroke that is only a few pixels wide, until the silhouette's
boundary was the ragged inside of a half-eaten line. Rounding the mask afterward cannot undo
a boundary that has already been cut, so the matte is left where the flood stops and the line
is drawn over it.

```sh
# from the plugin root, after `npm install` there for sharp
node skin/prep-masters.mjs               raw art in, palette-matched masters out
node skin/build-sprites.mjs <clip|all>   # default all
node skin/build-sprites.mjs --layers     write each rig's layers to layers/<rig>/
node skin/build-sprites.mjs --rest       reassemble each rig at rest, diff against its master
node skin/strip.mjs <clip> [samples]     lay sampled frames in a row for review
node skin/fig.mjs <px> <clip:n>...       whole figures side by side, for review
node skin/cut-preview.mjs                draw the cut lines and joints over the art
node skin/mask-preview.mjs [bone ...]    show which pixels each bone claims
node skin/outline-check.mjs <clip:n>...  draw a frame's outline over the master's
node skin/rowdiff.mjs <clip:n> [y0] [y1] per-row outline offset from the master
node skin/ledge-probe.mjs <dir/clip/n>...  biggest one-row jump in that offset: the neck seam
node skin/outline-scan.mjs [frames] [manifest]  rim pixels with no outline, per clip
node skin/outline-scan.mjs --mark <clip:n>  draw one frame's gaps in red
node skin/edge-quality.mjs [poses]        per master: edge length, soft ring, line weight
node skin/edge-profile.mjs <png> <x> <y> [dx] [dy] [n]  colors walking across one edge
node skin/neck-zoom.mjs [x y w h z] ...  zoomed strip of one joint across frames
node skin/cols.mjs [x0] [x1]              master: underside row per column
node skin/rows.mjs [y0] [y1]             master: outline columns, ink and blaze share
node skin/ink.mjs [y0] [y1]              master: interior line work per row
node skin/zoom-grid.mjs <x> <y> <w> <h>  gridded zoom, for placing a cut
```

- Cuts follow the master's own silhouette, never a hand-traced outline: an outline
  fragment left on the layer beneath shows as a loose arc the moment a bone swings.
- A bone's outer outline is the master's outline moved, so where its cut crosses the
  silhouette the moved outline meets the still one and leaves a ledge. The ledge is the
  outline's deviation from the motion's direction over the travel, so the head/body seam
  crosses at the neck's waist — (±59, 191) on the master, where the silhouette narrows
  from the cheeks before flaring out for the chest and the outline runs vertical. Motion
  there slides the head along its own outline instead of off it, and the head's joint
  pivot sits on that crossing.
- Between the waist and the axis the seam hugs the art's own jowl, six pixels under it,
  so the head keeps the whole mouth line and the body never copies it. Elsewhere a seam
  that copies a feature shows it twice: an earlier seam across the neck's plain band put
  the body's edge inside the jowl and read as a dark stripe.
- The body reaches above the seam by more than the head ever rises through it: 13 pixels,
  measured as the widest separation over every clip, worst on `head_pat` where a bobbing
  head adds the lag the body's spring hands it. Six left a crescent of desktop between the
  jowl and the shoulder. The head's own cut, not the body's upper edge, is what ends the
  head's coverage, so the ledge stays on the waist crossing where the outline is vertical.
  That band is **plain fur only** — every pixel of it, across every device column of a
  logical column, painted with the body's own color averaged over seven columns. Copying the
  master there also copies the jowl's outline, which stands out past the body's edge as a
  dark wedge the moment the head swings; erasing only the dark pixels leaves the antialiased
  edge half-removed and reads as a line of stitches; sampling one device pixel per column
  combs the band; and a per-column darkness threshold erases one column and spares its
  neighbour, which is the same comb again.
  Two things bound it. The band stops at the seam: the head covers everything above the seam
  and nothing below it, so a band that reaches past erases the body's own outline where no
  head will ever cover it, and the resting silhouette ran bare from row 191 to 195. And
  inside the band, only ink deeper than `OUTLINE_DEPTH` is repainted — measured on the master
  the outline runs nine to twelve device pixels in from the edge, and the jowl's line sits
  inside that — so the body's line survives and a raised head does not open a bare stretch of
  coat at the neck.
- The paw bone lifts the leg's lower half with it, and the master draws no underside behind
  that leg, so the body was left with a flat cut of bare coat and its outline stopped dead at
  the raised foot. The body now keeps the paw's pixels down to `PAW_FLOOR`, the row the belly's
  line runs along beside the leg, and closes that cut with the master's own line color faded
  over `OUTLINE_DEPTH`. The stroke lands inside the paw's footprint, so the paw hides it until
  it leaves: the resting assembly is unchanged, and a raised paw leaves a lined leg behind.
- Action goes through the bones that can carry it. The torso is the base bone, so leaning
  it about the feet, squashing it about the feet, or shifting it moves the crown tens of
  pixels and takes the seam along with the head; the head's own travel stays inside what
  the waist can carry (`clampHead`: no sideways slide, 2.5° of tilt, four pixels of bob).
  The waist's outline has a radius of curvature of about 4.5 pixels, so a head that slides
  `k` pixels costs a ledge of about `k²/9`, and one that turns `θ` degrees costs `59·θ` at
  the crossing; five degrees and six pixels measured 9.5 pixels of offset on `poke`, two and
  a half and four measure five.
  A "turn to look" is therefore a weight shift of the whole body with the head riding,
  which is also what a sitting dog does. Before this rule the head's locked sideways
  channel swallowed every look: measured on the baked frames, `look_left` moved the crown
  0.3 logical pixels and `thinking` 1.1.
- A pose is a request, not a per-frame instruction: the torso's tilt and lift run through a
  damped spring (`springFollow`), and the head takes that spring's error the other way, so
  it is left behind as the body starts and catches up as it stops. Loops integrate three
  cycles of their periodic target and keep the last, so the spring itself has no wrap seam.
  The head runs its own pair of springs on top of that correction — the body's lag is what
  the body hands the head, the head's spring is the head's own inertia — and `clampHead`
  bounds whatever the two sum to. A clip whose pose is already choreographed in phases names
  stiffer springs in `CLIPS` (`spring:`) so the keyframed crouch and landing survive.
- A looping state is a schedule of events, not an oscillation. `env(t, at, span, attack,
  hold)` is one gesture: it takes a pose, keeps it, and gives it back, and it is zero
  outside its span. A loop is then two or three unequal events with stillness between them,
  and the stillness is what makes the next event read — a pose that is always moving has no
  moment to notice. Anticipation goes in front of every action that starts from rest (the
  paw presses down before it lifts, the body coils before it wags, a flinch holds a beat
  before it jumps), and a reaction that reaches full speed on its first frame reads as a
  playback rather than a response.
- Two channels keep the held moments from turning into a painting: `heart` is a tremor near
  2Hz gated to the frames where no event is running, and `bwave` quickens the inhale against
  the exhale so the breath is not one symmetric ramp. Both stay on period 1 and whole
  harmonics, so the loop still joins itself.
- A one-shot must end where it started from. The helper holds a finished one-shot on its
  last frame until the clip underneath takes over, so that frame is what the next clip
  inherits. Sampling runs through `t = 1` for those clips (a loop stops one frame short, or
  it would show its first frame twice), every cycle count inside them is a whole number, and
  the body spring blends onto its target over the last fifth of the clip. `2.2` cycles of
  peck ends at `sin(0.2·2π) = 0.95`, which is a head stuck down: measured as silhouette
  pixels off the rest drawing, that cost 8.7k on `eat_token`.
- `snoise` takes whole harmonics at unrelated phases, and a pose calls it as
  `snoise(t * n + phase)` with `n` a whole number, because `t` is a fraction of the clip.
  A fractional `n` leaves the waveform somewhere other than where it started at the wrap:
  measured on the previous bake, `idle` jumped 2.7 pixels of crown travel once per 3.8
  seconds, and `eat_token` 6.9.
- The paw bone is the front foot, bounded by the art's own outline and turning about its
  wrist. The body yields the whole of it, so a lifted foot leaves the desktop empty: keeping
  any part behind — the leg's column between its two strokes, or the foot's flare outside
  them — leaves a second paw sitting on the ground where the first one was. The leg's strokes
  are drawn on top of the belly rather than around its edge, so they end at the wrist and stay
  there; that is where the foot begins, and it is the only place the two can separate.
  Reach comes from the foot's height rather than its turn: twenty-one pixels of foot rotated
  reads as a paw still on the ground and merely tilted.
- The laptop in the working clips is drawn from the far side, and that decides what is
  visible at all. The dog faces the viewer and faces the screen, so the screen faces away:
  the viewer gets the back of the lid standing on the desk, the base behind it, the keys
  under it, and the dog's front paws behind it too. The machine is wider than the dog is, so
  nothing of the typing can be seen — the paws are on the far side of the shell and the
  forelegs go behind it. The prop rides no bone: it is a thing on the desk, and it stays put
  while the body leans over it.
- Which leaves the shoulders as the only place the work can show, so `typingSchedule` hands
  its taps to the pose rather than to the prop. Each strike rolls the body onto the side that
  pressed the key (up to 2.8° about the feet) and compresses the chest toward them without
  translating the body down; the head springs take the opposite correction, so the eyes stay
  on the screen while the shoulders rock.
- The shell's bottom edge sits below the desktop line, with its contact shadow there rather
  than at the dog's ground line. A body that rolls about its feet drops one foot two and a
  half pixels under the line it stands on, and the master's feet already end on that line, so
  a shell stopping there lets them through.
- `working_command` stops being pleasant about it. The lids hold a third of the way down
  over the eyes, which is what a downward look is from the front — the pupil stays where the
  art put it, so covering its top aims it at the desk — the ears come forward, the head drops
  to the level the screen is at, the breath goes shallow, and the paws stop for a quarter of
  the clip while the output comes back.
- The `brow` channel draws attention by **extending** the arc the art already raises over
  each eye, carrying its inner end down toward the nose bridge into a downward slant. Two
  things were tried first and both are wrong here. A second brow laid over the first leaves
  two lines, because the old arc peaks a few pixels above the new path and no angle of the
  new one covers it without going flat over the eye. And painting the band back to `eyes.fur`
  showed as its own smear: that band is not one color, since the ear roots shade it toward
  pink where it meets the side of the head. The same boundary problem is why the smile cannot
  be taken out — it sits on the line between the muzzle's cream and the shading under it, so
  any band wide enough to cover the line paints over the shading and shows an edge.
- The lying rig is that body as one piece. The pose rests its head on its own paws, and
  that contact is what says "lying down" — a seam under the jaw breaks it instead of
  bending it. So the master is claimed whole, turns about the belly, and the life comes
  from a deeper slower breath, the spring's occasional dream twitch, and three Zs rising
  off the head. The Zs are drawn as a stroked path, not a glyph, so the bake does not
  depend on a font being installed. With no neck to carry the face, the lids ride the
  torso matrix.
- `waiting` is the lying rig with the eyes open: the same drawing, a shallower and quicker
  breath, and the two blinks a looping clip gets on its own clock. `sleep` is the same
  body holding its lids down.
- Two bridge clips carry the dog between those bodies, because lying down is not a pose
  the sitting rig can reach and a crossfade between two drawings reads as the animal
  dissolving. `lie_down` and `wake_up` share one parameterization: `u` runs 0 at sitting
  rest to 1 at lying rest, the sitting body squashes toward the desk (38% wider, 34%
  shorter, head down, eyes closing) as `u` grows, and the lying body arrives stretched
  taller and narrower than its rest and relaxes into it. The squash finishes before the
  dissolve starts, so the two drawings trade places while they hold the same low, wide
  shape, and the first and last frames are the two masters at rest — the clips they hand
  over to begin on the same drawing, which leaves no cut at either end. The lying master is
  awake, so the bridge closes its eyes with the same driver that shuts the sitting dog's,
  which keeps both drawings shut where they cross and hands `sleep` a body already asleep.
- Every clip's manifest entry names the `body` it stands on, and a bridge names none. The
  helper uses that to play the bridge itself whenever a state change crosses bodies, so
  lying down is a property of the skin rather than a special case in each caller.
- `dragging_protest` turns the dog all the way around. A turn is the one action the rig can
  express as a projection rather than as a stretch: the silhouette narrows as the body
  rotates away, and the frame where it has no width left is where the front drawing is
  replaced by `poses/back.png` — the same dog seen from behind, on the same axis and the same
  baseline, so the feet and the center never move and the swap cannot be seen. Nine frames
  per quarter turn put that moment on a frame; driving the turn by a fraction of the clip
  instead landed it between frames, and the width stepped from 26px to 116px in one frame.
- The tongue is a lobe offset from a curved spine, not a shape rotated about its root: a
  straight flap turning 168° in five frames is a card flip. Its tip leaves the mouth hanging
  and travels up the muzzle, stopping under the nose's leather — a tongue that passes over
  the nose reads as a bandage on the face. The half-width eases in over the first quarter of
  the root, holds its belly, and gives up only a third at the tip, where a circular cap
  closes it; the fork is line work on that cap rather than a notch cut into the silhouette.
  Narrowing all the way to a point instead makes the tongue a pink tab, and cutting the notch
  into the outline sharpens the point back off again. The bend follows the tongue's rate of
  travel, so it whips one way going out and the other coming back, and the sideways reach is
  wider on the way out than on the way back.
- The extension profile is `sin(πq)` to a power above one. At 0.85 the slope at the ends is
  infinite and the tongue snapped out of the mouth and back in over a single 40ms frame; the
  exponent must stay above one so it starts and stops at zero rate. A plateau at the top (the
  earlier ramp-hold-ramp) freezes the tongue mid-lick instead.
- The ears ride the head. Any cut through an ear's root either leaves its outline on
  the head or drags that outline across the crown, and no rotation small enough to
  hide it is worth calling motion. Ear language is a `perk` channel that stretches the
  head and ears from the neck.
- `POSES` holds one function per clip returning joint offsets from the rest pose: head
  tilt and perk, spring-driven flicks, breathing stretch about the feet, blink, mouth,
  tongue and lick. `clampHead` holds the head's sideways travel at zero and its rotation
  and bob at what the waist crossing absorbs; clips that read as a look carry it with a
  lean of the whole body, which moves no seam.

## Regenerating the master

`prep-masters.mjs` keys a raw AI image's solid background to transparent, drops
watermark pixels, trims, scales to a common height, and bottom-centers it. Raw art is
1024×1024 and the dog in it is about 700 pixels tall, so the 600-pixel `SS`-scaled master
comes out of a near 1:1 downscale rather than an enlargement. Keying cannot be trusted
inside the body, where pale fur sits as close to the background color as the background
does: the script floods thin pixels from the image border to find the real background and
leaves the interior solid.

Keying also cannot remove the background's color from the pixels it touched. The raw art
sits on saturated magenta, and the ring where the dog's outline fades out carries that
hue — measured on the keyed result before the fix, 1731 of the silhouette's 1992 edge
pixels were redder than anything in the drawing, which read as a pink fringe around the
whole pet and worst along the long flat edges of the belly. Making those pixels solid does
not clean them, so the script pulls each rim pixel's color in from the art beside it and
keeps the pixel's own coverage.

The AI concept renders the masters were drawn from are scratch and stay out of the repository;
`poses/idle.png` is the source art.

The matte is one bit per pixel, so every step the flood took along the drawing's antialiased
edge is left in the silhouette as a tooth. `smoothEdge` applies a three-by-three majority
filter twice, and it runs after the art is scaled to master size on purpose: at the raw art's
size the steps are two and three pixels, and the downscale carries them over rather than
averaging them away, so smoothing before it fixes nothing the eye sees. A pixel the filter
takes back becomes transparent; a pixel it adds had none, so it takes a neighbor's color, and
the line drawn afterward covers the seam either way.

Together the passes report what they changed, and the sitting master — which is the reference
and is never redrawn — comes back byte-identical from the whole sequence. `outline-scan.mjs`
is the measurement they answer to: silhouette edge with no ink within seven device pixels of
it, counted per clip over the baked frames.

## Deploy

Nothing is copied by hand. `assets/pet/**` and `assets/pet-manifest.json` are build output
like `runtime/bin/` is, so they stay out of git, and `scripts/ensure-assets.mjs` — which
`npm install` runs as `prepare` — bakes them with `npm run skin` whenever the shipped manifest
names a frame that is not on disk.

The macOS helper draws from the copy embedded in its `.app` bundle
(`Contents/Resources/assets`, copied by `native/macos/build.sh`), so a skin change needs
`npm run build:helper:darwin` even when no Swift code changed. Then refresh the installed
plugin and restart: a git-installed profile resolves a commit at install time, so it needs the
new commit, and the desktop profile is the application's own — install and uninstall happen on
the app's Plugins page. The manifest keeps the logical 412×344 in
`maxFrameWidth` and `maxFrameHeight`; that is the window size the helper lays out, and
the frames fill it at the display's own density.
