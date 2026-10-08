# Changelog

## Unreleased

### Added
- The plugin now introduces itself. DSH takes a plugin's display name, note, and icon from the
  `meta` block of the package's exported `locale/<language>.json`, falling back to
  `package.json` — and this package shipped none, so the installed row read `dsh-frenchie`
  beside upstream's description of itself as a fork. `locale/zh.json` and `locale/en.json`
  carry the title and one-line introduction, `locale/icon.png` is rendered from the idle pose,
  and `package.json` exports `./locale/*` and now speaks of itself with its own author. The Qt
  window title said 大肥鱼 while the AppKit one already said 法斗; both say 法斗 now, and the
  dependency-failure notice points at reinstalling this repository instead of an npm tag that
  was never ours.
- The multi-task card folds. An open list of five or six sessions covered a wide band of the
  desktop for as long as they ran; it now opens for six seconds and then settles into a chip
  the width of one line, naming the task that started first with `+N` against its right edge,
  because the work that has been going longest is the one worth reading. Hovering the bubble
  unfolds the whole list and holds it open until the pointer has been gone for two seconds —
  less than the fold timer, so a pointer crossing the chip on its way to the dog does not
  flash the list. The first task started is a new `startedAt` on each record, stamped where
  the reducer moves a task out of idle; the fold picks by it rather than by list order, which
  is a priority ranking and says nothing about when work began. The card reopens for a list
  that gained or lost a session, not for one that reported new progress — an active list
  rewrites its lines every few seconds, and a timer restarted by each of those would never
  come due. Both ports do this: the
  Swift window sizes itself around the chip's measured text, and the Qt twin fits the same
  line with `QFontMetrics`. The Qt widget now sets mouse tracking, since a card that opens on
  a hover has to be told about moves that press nothing.
- `native/macos/Package.swift` builds the state machine and the layout store as a
  `BigFishCore` library so `Tests/` compiles and `swift test` can run. Until now the two
  suites had never been executed anywhere — there was no package manifest, and the
  assertions had drifted from both implementations they described. `main.swift` is excluded
  from the library, which put `ProtocolIO` in its own file so the window code and the entry
  point can both use it.
- Quiet now settles the dog down in two steps. After `lieAfterMinutes` (default 1) of no
  DSH state and no touch it lies down with its eyes open — the same body the waiting state
  uses — and only after `sleepAfterMinutes` (default 6) does it close them and start the Z.
  Both count from the last sign of life, so the nap comes five minutes after the lying
  rather than after the last message; either one set to 0 skips that step, and lying is
  skipped whenever it would come after the nap. A new state while it lies gets it up again
  before the work starts. Nothing new is drawn: lying to napping is a crossfade between two
  eyelids on one body, and both steps answer to the same rise.
- The offered paw now lifts to about a third of the body's height, and the desktop is empty
  where it came from. The raise used to stop at the foot's own height because the body kept a
  copy of the foot underneath it: lift past that and a second paw stayed on the ground. The
  body now yields the foot's whole outline, so the leg's strokes simply end at the wrist —
  which is where the foot begins, and the only place the two can separate.
- An error now leaves the dog dazed. The state borrows the shaken-up reaction's swirl eyes
  and sway, and keeps the crouch: the body sinks and spreads, the ears go back, and the mouth
  stays open on a small whimper. The two read apart even though the eyes are the same drawing
  — being rocked by someone else is upright, being wrong about your own work is not. The
  swirl turns twice a loop against the drag's three, which is the difference between woozy
  and giddy.


- Running a command now looks like running a command. The brows draw themselves into a
  downward slant toward the nose, the lids hold a third of the way down over the eyes so the
  gaze lands on the desk in front of the dog, the ears come forward, the head drops to the
  level the screen is at, and the breath goes shallow. Then the paws stop for a quarter of
  the clip while the output comes back — the stillness is what separates watching a program
  run from typing without one.
  The brow extends the arc the art already draws rather than replacing it: a second line
  laid over the first leaves two brows, and painting the first back to flat coat showed as a
  smear, because that band is not one color — the ear roots shade it toward pink at the side
  of the head. The smile stays for the same reason: it sits on the boundary between the
  muzzle's cream and the shading under it, so any band wide enough to cover it paints over
  the shading and shows an edge.
- Waiting is now lying down and blinking rather than an eager sitting dog. The state shares
  the sleeping body — one master, drawn awake — with a shallower, quicker breath and the
  two blinks a looping clip runs on its own clock, so a pet with nothing to do settles down
  instead of bouncing, and waiting and sleeping differ by the lids rather than by a second
  drawing. Getting into the state lies the dog down and leaving it gets the dog up.
- Protesting now means turning its back on you. `dragging_protest` rotates the dog all the
  way around its own vertical axis, holds its back to the viewer with two impatient twists,
  and turns around again: the body narrows as it rotates, and the frame where it has no width
  left is where the drawing changes to a new master seen from behind — same axis, same
  baseline, so the feet never move and the swap is invisible. The drag chain holds the stage
  long enough (1.6s) for the turn to finish.
- Getting up and lying down are now actions rather than cuts. The two bodies are separate
  drawings, so a state change between them was a 0.12 second crossfade — the dog dissolved
  into a sitting shape. `lie_down` and `wake_up` bridge them: the sitting dog squashes
  toward the desk with its eyes closing, the lying dog rises to meet that shape, and they
  trade places inside the squash. Each bridge starts and ends on the master its neighbours
  hold, so the handover shows no cut either.
- Every clip's manifest entry now names the body it stands on, and the animation model
  plays the matching bridge whenever a change of state crosses bodies. A caller that asks
  for `waiting` gets the lie-down in front of it without knowing the dog has two drawings,
  and a change that lands mid-bridge joins the queue rather than cutting through the
  dissolve. The drag clips stay outside this: they follow the pointer and take the frame
  they are given. The nap is now just the sleep clip, which retires the overlay handover
  both helpers carried for it.
- A new `sleepAfterMinutes`
  setting (default 5, 0 disables) counts quiet since the last DSH state, task or
  interaction; on expiry the pet plays a looping sleep clip — a lying body, closed eyes,
  a slow breath, an occasional dream twitch and rising Zs — and any of those signs of
  life wakes it. Both helpers carry the same countdown and the same rule that only the
  sleep overlay ends on a message, so a click reaction the user started is never cut off.

### Changed

- Both READMEs are written for this project. They described upstream's distribution — npm
  `latest`, GitHub Releases, `.tgz` archives, a version number the manifest never carried — and
  a status gallery screenshotted from the whale-tail maid this fork does not ship. What is here
  now is what this repository does: install from a clone, the state-to-clip table read off
  `stateMap` and `workingActivityMap`, the two-step settle from lying to sleeping, the folded
  task card, every setting with the default its schema actually declares, and the boundaries
  that hold (ad-hoc signature, Simplified Chinese only, gaze-follow on the macOS port alone).
  `docs/images/frenchie-states.png` replaces the seven upstream screenshots, composited from
  the frames this plugin ships — one per state.
- The plugin is now a repository of its own. The skin pipeline moved from the harness
  workspace (`scripts/frenchie-skin`) to `skin/` beside the sprites it bakes, so a clone can
  change a pose and rebake it without the harness; the frames it writes are byte-identical to
  the ones shipped. Every script there resolved sharp through a try/catch with a fallback that
  named one machine's pnpm store path — seventeen copies of it — and they now import one
  `skin/sharp.mjs` that finds sharp as this package's dev dependency or in the nearest store
  above, and says to run `npm install` when neither answers. The pipeline's own output —
  `skin/frames/`, which is the same 1240 webp files `assets/pet/` ships, and the
  `skin/layers/` debug dumps — left git with it: `npm run skin` rebuilds both from the three
  masters, which stay tracked.
- Installing from git builds the Helper instead of shipping one, where that is cheap:
  `prepare` runs `scripts/build-helper.mjs --prepare`, which builds the macOS Helper in
  thirteen seconds from the `swiftc` every Command Line Tools install already carries, and on
  Windows and Linux prints the one line naming the command to run instead. The Qt Helper there
  wants Python, PyInstaller and PySide6 — minutes of fetching and freezing — and an install
  that spends them silently, then fails on the machine that lacks them, is worse than a
  printed instruction. `runtime/bin/` was never in git, and a clone had to know which
  `build:helper:<platform>` to run. The READMEs, `docs/UPDATING.md`, the cursor digest note,
  and the package metadata dropped the upstream npm and GitHub Release channels they still
  described. What the desktop application then showed, on a real install run: the CLI refuses
  to touch the Electron profile at all, so plugin install and uninstall happen in the app's own
  Plugins page; and the download behind a git install was 40 MB of frames arriving at about
  17 KB/s from `codeload.github.com`, which no `settings.fetchTimeout` could survive. That is
  what the entry above this one fixes.
- The sprite frames left git too. `assets/pet/` is 1240 webp files — 37 MB, every one derived
  from the three 716 KB masters in `skin/poses/` — and it was the only reason a clone or a
  repository install had to move 40 MB at all. `prepare` now runs `scripts/ensure-assets.mjs`
  before it builds the Helper: it checks each path the manifest names, so a partial or stale
  `assets/pet/` rebakes and a complete one costs one line of output. The repository tracks 75
  files and 1.2 MB, and one full install from the repository — resolve, download, bake, build —
  measured 1 m 56 s, with the frames byte-identical to the set this removes (fingerprint
  `d37ba7e07b1488df2f9d774786668f1a`). The allowlist key pnpm prints follows the spec, so the
  documents say to copy it verbatim: `git+ssh://…` yields `dsh-frenchie@git+ssh://…#<commit>`,
  `git+https://…` yields the resolved codeload tarball URL, and pnpm 10 wants the package name
  in `onlyBuiltDependencies` instead.
- `npm test` runs checks that exist. It listed fifteen `test/*.test.js` files and a
  `runtime/tests` unittest discovery, none of which are in this repository — the fork dropped
  them — so the default command could only ever fail. It now drives the packaged Helper over
  the real protocol and grabs a visual snapshot, and `test:swift` runs the state-machine and
  layout suites under `native/macos/Tests/` (Xcode required: Command Line Tools ship no
  XCTest).
- Metadata names this repository: `repository`, `bugs` and `homepage` no longer point at the
  upstream `dsh-dafeiyu`, and the version line in both READMEs matches `0.1.0` in the manifest.
  layer — `breathe`, `think`, `work`, `wait`, `bounce`, `shake`, `dizzy`, `float` — that
  scaled, rotated and offset the whole window, keyed off a `motion` field on the clip. No
  clip of this skin declares one, so the branch had never run and the drawing path still
  paid for it on every frame. The layer, the field and the window's rotation and scale are
  gone; "reduce motion" now means exactly what it does: no idle micro-actions, no
  drag-release chain, and looping clips held on their rest frame.
- macOS fades between clips on the same schedule as the other platforms: 0.10s across clips
  and 0.045s within one, where the native port had drifted to 0.12 and 0.05. The eye dart
  switches without a blend there too, which it already did here — a glance is a sudden
  movement, and blurring its first frame softens the thing that makes it a glance. The set
  of hard-switching clips is the same on both sides, minus `blink`, which names no clip.
- An open mouth now shows a tongue rather than a pink tab. It was twelve logical pixels wide
  at the root, narrowing 58% all the way to a point that a notch then cut deeper, so against
  a mouth forty-six pixels across it read as a thin wedge. It is seventeen to twenty-six wide
  — over half the mouth — eases in over the root, holds its belly, and gives up only a third
  at the tip, which closes on a round cap; the fork is line work on that cap instead of a cut
  into the silhouette. It also hangs two pixels further, so at a full pant it lies over the
  lower lip rather than floating inside the hole.
- The drag-release reaction holds each stage for its own animation. The three stages carried
  300/840/1600ms from when the first two were single-frame poses; as 24- and 64-frame
  animations they were cut at 37% and 36% of their length, and the release stage broke off
  on the frame sitting 99% of its peak displacement away from rest — the moment the body is
  furthest from where it belongs. Since the drag family switches without a crossfade, each
  cut was a jump. The holds now come from the manifest (`clipLengthMs`), so a stage can
  never be cut again by a retimed clip, and the chain runs 816 + 2304 + 1584ms.
- `working_search` is gone: searching now plays `working`. The two were one animation — the
  clip was declared with `pose: 'working'`, the same 64 frames at the same 40ms, and nothing
  but its own random seed, so the paws tapped different keys on the same body. Baked frames
  confirm it: the average drawings differ by 1.3% and the motion maps by 8.7%, which is the
  closest pair among the 26 clips and an order of magnitude closer than any other two. The
  five working activities now answer to two animations — `working` for searching, editing and
  other tool calls, `working_command` for commanding and testing.
  Dropping the clip also drops the window-level bob both helpers laid on top of
  `working_search` and `working_command`: it rotated the whole window ±2.5° and hopped it 5px,
  so the laptop on the desk rocked with the dog, it applied while reduced motion was on, and
  after the merge it would have shaken the command animation alone. The shoulders and the
  head already carry the keystrokes in the frames.
- Each state is now a schedule of gestures with stillness between them, rather than one
  oscillation. A looping clip plays two or three unequal events — a weight shift, a look
  held and given back, a sniff — and an action that starts from rest anticipates it: the paw
  presses into the ground before it lifts, the body coils before the wag, a flinch holds a
  beat before it jumps. Between events the dog is held, with only a gated tremor near 2Hz and
  a breath whose inhale is quicker than its exhale, so the still moments stay alive instead of
  freezing. The head runs its own springs on top of the body's lag, so a gesture overshoots and
  settles rather than arriving on schedule. Measured on the baked frames as crown travel per
  40ms frame (peak, and across the loop): `idle` 1.0 → 3.2 over 27.3 → 40.3px, `waiting`
  2.5 → 5.6 over 23.3 → 39.7, `error` 1.0 → 2.4 over 13.8 → 24.4, `thinking` 1.0 → 1.6 over
  16.8 → 24.5, and `success` now hops twice with its own crouch, landing and settle (5.7 →
  15.0). Loops still join themselves at the wrap, and the neck seam holds: the worst outline
  offset on any sitting clip is 8px, as before, and the rest assembly still matches the masters.
- The lick is a tongue now. It was one straight lobe rotated 168° about its root in about
  five frames, which reads as a card flip; it travels a curved spine instead — out from the
  lips, up the muzzle, stopping under the nose's leather rather than over it — with the
  half-width narrowing 58% to a notched tip and the bend following its rate of travel, so it
  whips one way going out and the other coming back. The extension profile no longer has
  infinite slope at its ends (measured: 14.7px of tip travel between two 40ms frames), each
  lick runs over 13 frames instead of 6, and the muzzle dips and the ears sag as it reaches.
  Every clip that shows a tongue — `success`, `tail`, `paw_offer`, `eat_token` — draws the
  same lobe, so the resting panting tongue lost its flat cut end too.
- Hover, click and drag now apply to the animal itself. The skin declares the box each
  clip's own pixels occupy (`bodyBox`), and a press outside it — in the margin beside the
  dog or on the bubble above its head — starts neither a drag nor a reaction.
- The status bubble is a compact two-line caption (300x62 points at the default bubble
  scale, down from 420x84) with a smaller state disc, so it stops dominating the desktop
  next to the pet. It still carries the live work line while a task runs.
- Motion now travels through the bones that can carry it, so the states stop looking like
  the same idle loop. Action had been asked for on the head's sideways channel, which the
  neck seam locks, and the clamp discarded it: measured on the baked frames, `look_left`
  moved the crown 0.3 logical pixels and `thinking` 1.1. A turn to look is now a weight
  shift of the whole body about the feet with the head riding, and a dip is a squash about
  the feet. Crown travel went from 4.0 to 11.8 pixels in `idle`, 1.1 to 11.7 in `thinking`,
  0.5 to 10.1 in `error`, 1.9 to 10.0 in `working`.
- The body answers a lean or a lift through a damped spring and the head takes that spring's
  error the other way, so it is left behind as the body starts and catches up as it stops —
  the secondary motion that reads as a body carrying a head rather than a cutout sliding.
- Loops no longer tick where they wrap. The noise driving the joints used incommensurate
  frequencies, so a looping clip began its next cycle somewhere other than where it ended:
  a 2.7-pixel jump once per `idle` loop, 6.9 in `eat_token`. Its harmonics are whole numbers
  now, and a pose may only scale time by a whole number.
- The neck seam stops opening. The body reached six pixels above the seam while a bobbing
  `head_pat` separated the head from it by more, which showed a crescent of desktop between
  the jowl and the shoulder; the overlap is 13 pixels, the measured worst separation across
  every clip.
- `dragging` and `dragging_dizzy` carry the same shake over more frames, so a fast wobble
  stops stepping.

### Fixed

- Lying down no longer costs the dog its outline. The lying art is drawn with a line that is
  thin, pale and uneven where the sitting art's is thick and dark, and the matte's second pass
  — peel anything touching the background that is lighter than luminance 180 — ate that thin
  line row by row until the silhouette's boundary was the ragged inside of a half-eaten
  stroke, most visible along the rear flank and the foot. There is no second pass now: the
  flood walks the near-white, nearly colorless band hugging the character, stops at the
  drawing's own outline, and the silhouette is rounded at master size, where the steps are the
  size the eye reads. The rim is then drawn from the sitting master — its width, its color,
  faded into the coat — which closes the back art's unlined stretches too, without redrawing
  the sitting art the line is taken from. Over the baked frames, silhouette edge with no line
  within seven device pixels of it goes from 3239 to 2864 pixels across the skin, and
  `dragging_protest` from 490 to 114.
- A raised paw no longer leaves the body's outline broken. The paw bone lifts the leg's lower
  half with it, and the master draws no underside behind that leg — the cut it left in the
  body was a flat stretch of bare coat, so the belly's line stopped dead at the raised foot.
  The body now keeps the paw's pixels down to the row its own underside runs along and closes
  that cut with the master's line color; the stroke sits inside the paw's footprint, so the
  resting assembly is unchanged and only a raised paw shows it. `wave` and `paw_offer` drop
  from 2383 and 1886 bare rim pixels to under 550 each.
- The outline is one line around the neck again. The band of plain fur the body carries above
  the head seam reached five pixels *below* the seam, and the head never covers that part, so
  the body's own outline was erased there: on the resting frame the silhouette ran bare from
  row 191 to row 195, and the edge read as separate strokes. The band now ends at the seam,
  and inside it only ink deeper than the outline is repainted — the jowl's line goes, the
  body's line stays — so raising the head no longer opens a bare stretch of coat at the neck.
  Measured as silhouette rim with no line within seven device pixels of it, the sitting clips
  go from 446 bare rim pixels across `idle`, `thinking`, `head_pat` and `success` to 12, and
  18 of the skin's clips now have no bare rim at all.
- The dog seen from behind had no outline over a tenth of its edge. The back master's coat ran
  straight into the background along the lower body, so turning to protest showed a figure
  with an open edge. Every master now closes its own rim: a rim pixel counts as lined when
  some inked pixel sits within six device pixels of it — which leaves a toe gap as drawn,
  since it is lined on both sides — and the rest takes the master's own line color, faded over
  the last few pixels so the painted stretch has the drawn one's width. The sitting and lying
  masters come back byte-identical from the pass; `dragging_protest` drops from 8796 bare rim
  pixels to 490.
- The lying body's outline is as dark as the sitting one's. A fresh generation can match the
  coat and still be drawn with a lighter hand: measured one to six device pixels inside the
  silhouette, the sitting outline sat at luminance 118 and the lying one at 140, which at the
  size the pet is drawn reads as a blurry edge rather than a soft one. Each master's rim is
  now scaled onto the reference outline, weighted by how far a pixel is from the coat's own
  luminance so the pale fur at the edge keeps its color.
- The pose palette match keeps its result inside the channels it writes. The affine map sends
  the art's darkest ink below zero when the reference is lighter than the pose, and writing
  to a raw `Buffer` wraps −16 to 240, which recolored the lying dog's eyes from near-black to
  blue and left cyan specks along their rims.
- Die-cut source art no longer arrives wearing a sticker. The band of near-white pixels
  hugging the character is far enough from the background color that keying left it in place,
  and the coat's own highlights are exactly as white, so no color threshold names one without
  the other. The matte now floods the outside on warmth — every color in the dog has blue
  below green, where the band and the magenta it was cut against have blue above it — and
  peels what is left by luminance, which stops on the outline.
- A click reaction hands back without a pop. One-shots are held on their last frame before
  the clip underneath takes over, and several ended mid-motion: the peck stopped with its
  head down (2.2 cycles does not land where it began), and the body spring was still swinging
  when the clip ran out. One-shots now sample through `t = 1`, their cycles are whole, and the
  spring blends onto its target over the last fifth of the clip. Measured as silhouette pixels
  away from the rest drawing at the final frame: `eat_token` 8719 → 74, `tail` 2976 → 476,
  `wave` 840 → 284, `poke` 89 → 26.
- The neck stops peeling while the dog moves. Two things were showing at the seam: the head
  was allowed five degrees of tilt and six pixels of bob, which at the waist's 4.5 pixel
  radius of curvature measured 9.5 pixels of outline offset on `poke`, and the body's overlap
  band above the seam was a copy of the master — including the jowl's dark outline — which
  stood out past the body's edge as a wedge the moment the head swung off it. The head carries
  2.5° and four pixels now (worst offset five, mean 2.2), and the band is painted with the
  body's own plain fur across every device pixel of each column. The accents those degrees
  were carrying stay, because they live on the body's lean.
- The laptop is a laptop on a desk, seen from the far side. It first faced the viewer with a
  lit screen, which puts the display on the wrong side of the dog; showing the back of the
  lid got the side right but still drew the keyboard, then the paws, in front of it. The dog
  works *behind* the machine — the base is on its far side, the keys under it, and the front
  paws behind the shell, which is wider than the dog. So none of that is visible from here.
  The keystrokes go where they can still be seen: into the shoulders. Each strike rolls the
  body onto the side that pressed the key, by up to 2.8°, and compresses the chest toward the
  feet without sinking it, so the two sides alternate while the head springs take the opposite
  correction and the eyes stay on the screen.
- The shell now reaches below the desktop line the dog stands on, and its contact shadow
  moved with it. A body that rolls 2.8° about its feet drops the far foot two and a half
  pixels under that line, and the feet already rested on it — a shell ending at the line let
  them peek through. Measured on the baked frames, no coat-colored pixel survives below the
  shell's edge on any frame of the three working clips.
- The error state lifts its head just enough to let out a whimper once a loop before dropping
  it back; `success` barks as it lands, twice, with the head snapping back and the body
  pushing under it; `dragging_dizzy` has swirls for eyes, turning three times a loop.
- The sleeping dog is the same color as the awake one. Its master came from a second
  generation of the art and carried its own cast — a golden coat where the sitting dog is
  pale fawn, no cream, an outline near twice as dark — so lying down looked like changing
  dogs. `prep-masters.mjs` now matches every later master to the sitting one's per-channel
  mean and spread; the sleep clip went from mean rgb(200,161,116) to rgb(213,181,146)
  against the sitting clip's rgb(216,184,151).
- Toggling the pet from the account row now persists. The settings endpoint wrote through
  `settings.update(patch)`, a method the host's settings service does not have on that
  scope, so every write — including hide — failed and the helper stayed exactly as it was.
  The endpoint now addresses the plugin's own profile entry (`settings.update(ns, patch)`),
  every `Config` field is declared volatile so the entry accepts live edits without a
  remount, and the running helper picks each change up from the loader's
  `loader/volatile-update`. The bundled installation patch no longer restates the schema
  defaults, so a written value is the only override on the entry.

## 0.1.14

### Changed

- Companion animation now plays at the source clips' native 24 fps. The
  bundled set had been decimated to 8 fps by the npm size emergency in 0.1.10;
  the asset budget that Phase 1 freed makes the full-motion frames fit again.
  Measured: 864 frames / 13.7 MB becomes 2,600 frames / 41.1 MB, so the
  published archive grows by about 27 MB.
- The Qt and macOS helpers keep only the compressed frame bytes resident and
  decode through a bounded cache instead of holding every decoded frame in
  memory. Measured working set during live animation: 517 MB becomes 100 MB.
- The animation timer now polls at a third of the active clip's frame period
  (clamped to 8-20 ms) on both desktop renderers. Driving 42 ms frames from the
  previous fixed 20 ms tick left frame changes pinned to the polling grid
  (measured 29.4% interval jitter and 80 ms holes); the sub-frame grid absorbs
  a late delivery instead. Measured: 23.8 fps with 17.2% jitter and no gaps.
  A 125 ms manifest keeps the previous behaviour exactly.
- The in-page overlay drives its loop from `requestAnimationFrame` with a
  time accumulator and prefetches the next frame, replacing the drift-prone
  `setTimeout` chain that reloaded each frame cold.
- Desktop animation costs about 31% of one core while animating, against 17%
  at 8 fps: three times the decoded frames is the price of the higher cadence.

### Fixed

- Correct the importer's stale documentation, which still described the
  0.1.10-era 12 fps import that 0.1.10 itself replaced with 8 fps.

## 0.1.13

### Added

- Opt-in in-page companion (web-first refactor Phase 3): a new `webOverlay`
  setting (default off) renders a small decorative pet in the bottom-right of
  the DSH page. The client module reads the setting once at mount, subscribes
  to the loopback SSE channel, and animates manifest-declared WebP frames;
  every failure path ends in "no pet", never an exception reaching the WebUI.
  New loopback-only routes serve the manifest and allowlisted frames
  (`/plugins/dsh-dafeiyu/manifest`, `/plugins/dsh-dafeiyu/frame`).

## 0.1.12

### Added

- Expose a loopback-only server-sent events channel at
  `/plugins/dsh-dafeiyu/events` that mirrors every companion message
  (snapshot kinds replay on connect, transient pulses do not). This is the
  data plumbing for the planned in-page web overlay; the native Helper path
  is untouched.

### Changed

- The npm package now ships the animation assets once: the Windows/Linux
  Helper binaries no longer embed a copy of `assets/`, and the versioned
  Windows-local cache (WSL since 0.1.6, native Windows since 0.1.11) carries
  an `assets/` directory next to the cached executable. A frozen helper
  resolves assets from its own neighbourhood first and keeps the `_MEIPASS`
  fallback so older cached builds upgrade cleanly. This removes ~40 MB of
  duplicated payload and restores headroom for the planned web-first
  rendering work.

## 0.1.11

## 0.1.10

### Changed

- 大肥鱼视觉优化（素材更新）：the bundled companion animation set is now
  imported from the MIT-licensed [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
  community project (Credit: PC2005-cloud). Every state (idle, waiting,
  thinking, working, searching, commanding, success, error), the drag phase,
  and touch reactions now play full-motion 12 fps transparent WebP frame
  sequences (412x344 crop of the source 640x360 canvas, 21 MB total) instead
  of single-pose sprites with procedural wobbles. The set ships at 8 fps
  (classic-anime cadence, 13 MB total) and the archived BigFish frames moved
  out of `assets/` so the per-platform Helper binaries no longer embed them
  three times over; the 0.1.10 npm publish was rejected as Payload Too Large
  (206 MB) before this budget landed. Reduced motion still freezes
  looped clips on the standing pose, and the dizzy reaction keeps its
  procedural motion. The previous BigFish frames are archived under
  `legacy/dafeiyu/`, excluded from the npm bundle, and keep their
  original restricted terms; the upstream MIT notice ships as
  `assets/dsh-pet-LICENSE.txt` and `ASSET_LICENSE.md` documents both provenance
  chains. `scripts/import_dshpet_webm.py` reproduces the conversion from the
  upstream release.
- Both renderers keep reading sizes from `pet-manifest.json`, so the new
  envelope requires no runtime code changes.

### Fixed

- On native Windows the Helper now runs from the versioned cache under
  `%LOCALAPPDATA%\dsh-dafeiyu\<version>\` (the mechanism introduced for WSL
  in 0.1.6, now applied to win32 as well), so the plugin directory never
  holds a running executable and `dsh plugin ... update` no longer fails with
  `ERR_PNPM_EPERM` rename errors while DSH is open (#66). Cache preparation
  stays an optimization: any failure falls back to launching the bundled
  path directly.

## 0.1.9

### Added

- Add the native glove hand cursor for the companion window on Windows
  (community PR #33): hovering and grabbing the pet shows custom `.cur`
  cursors (`cursor_grab` / `cursor_grabbing`) loaded through Win32
  `WM_SETCURSOR`, with all three cursor API functions declaring explicit
  pointer-sized `argtypes`/`restype` so 64-bit handles are never truncated,
  and graceful fallback to the system cursor when loading fails or on
  non-Windows platforms. Cursor assets are BSD-3-Clause licensed (Chromium),
  documented under `assets/cursors/` and `ASSET_LICENSE.md`.

## 0.1.8

### Added

- Keep the DSH host boot alive when plugin activation fails (for example a
  host-side settings or web-server API change after a DSH update): activation
  errors are now logged and the pet stays disabled for that session instead of
  rejecting the whole plugin tree, matching the import-time guard shipped in
  0.1.7.

## 0.1.7

### Changed

- Update the artifact upload and download actions used by the release workflow to their Node.js 24 versions, removing GitHub-hosted runner deprecation warnings and enforcing artifact digest mismatches as errors.
- Remove completed Phase 0 planning material and the unused legacy UI acceptance harness.
- Consolidate repeated task ordering and reduced-motion transitions without changing runtime behavior.

### Added

- Document verified macOS Gatekeeper behavior in both READMEs (issue #24):
  npm installs, terminal downloads, and browser-downloaded `.tgz` archives
  installed directly never trigger Gatekeeper; only Finder-extracted `.app`
  bundles carry quarantine attributes. Includes the recommended install flow,
  terminal download commands, and the `xattr` cleanup for users who already
  extracted with Finder.
- Degrade gracefully when a packaged runtime dependency cannot be resolved
  (for example an incomplete `link:` install): the loader entry now imports
  the plugin behind a guard, logs one actionable notice naming the missing
  package and the reinstall command, and exports an inert plugin so the DSH
  plugin tree and all other plugins keep booting instead of failing with
  `ERR_MODULE_NOT_FOUND` (#39).
- Add repeatable Swift unit tests for the native animation state machine
  (`native/macos/Tests/AnimationModelTests.swift`, 18 cases, run via
  `swift test` in CI), ported from `runtime/tests/test_animation_model.py` so
  the Python and Swift implementations cannot silently drift.
- Add repeatable Swift unit tests for layout persistence
  (`native/macos/Tests/LayoutStoreTests.swift`, 14 cases) and fix the drift
  they exposed: missing `XDG_CONFIG_HOME`/`LOCALAPPDATA` fallbacks, JSON
  booleans being accepted as coordinates/scales, `bubbleStates` not filtering
  invalid entries, and `save()` skipping Python-compatible normalisation.
- Add repeatability cases: layout save/load round trips are byte-stable,
  `normalized()` is idempotent, repeated loads and identical state-machine
  input sequences are deterministic.
- Make the JS heartbeat test assert protocol semantics instead of JSON
  whitespace: it now parses event-log lines and checks `kind`, so both the
  Swift and Python helpers pass regardless of serializer formatting.
- Verified the full test matrix on a MacBook Pro (Apple M3, arm64, macOS
  26.5.2): Swift 32/32, Python 20/20, JS 71/71, packaged smoke test, universal
  architecture and signature checks, and an end-to-end page-open/close cycle.

## 0.1.6

### Added

- Display the reasoning effort that DSH actually applies to each request in the companion status detail, and keep it visible as the task moves between thinking, tool use, and waiting states.
- Add four community-contributed dragging poses and a short release, dizzy, and protest reaction sequence, with reduced-motion fallback and interruption when the pet is grabbed again.
- Bring the native macOS Helper to feature parity for that drag-release reaction sequence, including safe cancellation when reduced motion is enabled or the pet is grabbed again.

### Fixed

- WSL visual mode now caches the bundled Windows Helper under the Windows user's local app-data directory before launching it. Re-enabling the pet no longer makes Windows repeatedly read and unpack the large PyInstaller executable through `\\wsl.localhost`; cache failures still fall back to the packaged Helper.

## 0.1.5

### Fixed

- Bundled the plugin's runtime schema dependencies so DSH profiles can load installs whose package directory is linked from outside the profile tree.
- Bounded Helper IPC buffering under write backpressure and stopped repeated post-readiness crashes after a finite retry budget, preventing stalled Helpers from causing unbounded memory or process churn.

## 0.1.4

### Added

- Linux x64 desktop support with a bundled, Python-free Helper (official binary built on Ubuntu 22.04 / glibc 2.35; desktop verified on Ubuntu 24.04 / glibc 2.39), XDG layout persistence, and X11/Wayland platform selection.
- Linux Helper build, visual smoke test, and final npm-archive validation in CI and the trusted release workflow.
- Native macOS Helper built with Swift and AppKit as a universal arm64/x86_64 app for macOS 12+, with no Python runtime requirement.
- Native macOS build, AppKit screenshot/lifecycle smoke tests, universal-architecture and code-signature checks, plus validation of the final assembled npm archive on a macOS runner.

### Changed

- Removed the npm x64-only installation restriction so Apple Silicon Macs can install the universal package.

## 0.1.3

### Fixed

- Plan mode's `exit_plan_mode` approval step now shows the waiting state instead of working.
- Character size, bubble size, and reduced-motion changes made from the desktop context menu now sync back to DSH settings and survive a restart.

### Changed

- Character scaling now supports 55% to 140%, with a 60% mini preset in the desktop context menu.
- Replaced the generic system beep with original, quieter success and error chimes and added a notification-sound setting.

## 0.1.2

Fixes for WSL reliability and project renames.

> Note: the v0.1.1 tag was blocked before npm publishing by a Windows-only test
> (the cmd.exe resolution test asserted a host path). The test is now platform-neutral;
> the same fixes ship here as 0.1.2.

### Fixed

- WSL visual mode now launches the bundled Windows Helper through the absolute
  `C:\Windows\System32\cmd.exe` path (resolved via `wslpath`), falling back to the bare
  name only if that fails. Previously it depended on `cmd.exe` being on the WSL PATH, so
  WSL installs without System32 in PATH could never start the pet.
- The status bubble now shows the current project name after a folder rename instead of
  the stale name frozen in the session header: the freshest working-directory source
  (live session cwd / step projectName) wins over the older header title/name.
- Added regression tests for both fixes.

## 0.1.0

Promoted to stable. Same hardened build that shipped as 0.1.0-alpha.15, now the default
`latest` npm version so plain `dsh plugin add dsh-dafeiyu` installs a DSH rc.7-compatible
release instead of the stale 0.1.0-alpha.6.

## 0.1.0-alpha.15

Fault isolation and robustness hardening so the pet can never take down
other plugins or the whole DSH host.

### Fixed

- Host-side `session/event` and `session/disposed` listeners are now exception-isolated,
  so a single bad event from DSH can no longer throw into the shared bus and stop every
  other subscriber (which previously could present as "installing the pet broke other
  plugins")
- The bundled web client registers its settings card inside a fault-isolated guard: if DSH
  changes the slot contract again, only the BigFish card is lost instead of the whole WebUI
  failing to load
- Helper pipe errors (EPIPE) are now swallowed on stdin/stdout/stderr so a dead helper can
  never crash the DSH host process with an unhandled `error` event
- The bounded-restart guard now also covers helpers that spawn successfully but die before
  sending `READY`, instead of only missing/broken binaries (no more unbounded restart loops)
- README download links point at `/releases` instead of `/releases/latest`, which returned
  404 while every published release is a pre-release

### Release engineering

- Added GitHub Actions trusted publishing: the Windows Helper is built and smoke-tested on Windows,
  while npm publishing uses short-lived OIDC credentials instead of local npm login state
- Added retry-safe npm archive verification and automatic GitHub Release attachment publishing

## 0.1.0-alpha.13



Bug fixes and DSH rc.7 compatibility hardening.



### Fixed



- Helper now clears a failed spawn and schedules a restart, so a missing/broken Helper no longer leaves the plugin wedged

- Added `approval/asked` / `approval/decided` handling so permission approvals show a “等待审批” desktop prompt instead of staying on “工作中”

- `pluginVersion` now reads from `package.json` instead of a stale hardcoded version

- README current-version badges updated

- Added a regression test that actually exercises the DSH rc.7 keyed slot registration



## 0.1.0-alpha.14



Reliability hardening.



### Fixed



- Helper start failures are now bounded: after `maxStartFailures` (default 5) consecutive failed spawns the plugin stops retrying instead of looping forever, protecting DSH and logs from a missing/broken Helper

- Added regression coverage for the bounded retry behavior



## 0.1.0-alpha.12



Loader compatibility fix.



### Fixed



- Updated `cordis.patch.yml` to include the current plugin config fields (`bubbleScale`, `bubbleMode`, `bubbleStates`), reducing the chance of `failed to apply loader entry` after DSH Harness updates

- Added the required `key: 'dsh-dafeiyu'` when registering the `settings.plugin.item` slot, fixing DSH rc.7 `requires options.key` loader failures



## 0.1.0-alpha.11



Bubble visibility modes.



### Added



- New “气泡显示” setting in the DSH plugin panel: 常驻显示 / 完全隐藏 / 自定义显示状态

- Custom mode lets users choose exactly which DSH states show the status bubble

- When bubble is hidden, the Helper window shrinks to the character only



### Changed



- Supersedes the simple global hide-bubble idea with a three-mode design that also covers Issue #15

## 0.1.0-alpha.10

WSL2 support and Issue #12 desktop interaction enhancements.

### Added

- WSL2 support: allow installation on Linux and run the bundled Win32 Helper through WSL interop ([#8](https://github.com/QCYTSN/dsh-dafeiyu/pull/8))
- Right-click “打开 WebUI” action to reopen the DSH WebUI from the desktop pet ([#12](https://github.com/QCYTSN/dsh-dafeiyu/issues/12))
- Completion/error alert feedback: beep plus a brief window shake on SUCCESS/ERROR pulses ([#12](https://github.com/QCYTSN/dsh-dafeiyu/issues/12))
- Multi-task status card: when multiple DSH sessions are active, the pet bubble lists the running tasks and their states ([#12](https://github.com/QCYTSN/dsh-dafeiyu/issues/12))

### Changed

- Removed the npm `os` restriction so WSL2 installs are accepted while retaining the x64 CPU requirement
- WSL2 launches the Helper through `cmd.exe`, so npm's Linux executable bit is not required
- The helper now snapshots and replays the multi-task list after a restart

### Update

Fully exit DSH, then run:

```powershell
dsh plugin --profile web update dsh-dafeiyu@alpha
```

Restart DSH after the update.

## 0.1.0-alpha.9

Windows drag-stability hotfix release.

### Fixed

- Removed procedural floating motion from the single-frame dragging pose
- Switched into and out of the dragging pose atomically instead of crossfading through an already-painted frame
- Paused animation and idle-micro timers while dragging so timer repaints no longer compete with Windows mouse-move repaints
- Restored the latest live Agent state immediately after release, including state changes received during the drag ([#10](https://github.com/QCYTSN/dsh-dafeiyu/issues/10))

### Validation

- Added regression coverage for drag transitions, live state updates during dragging, and the stable dragging asset contract
- Rebuilt the Windows x64 Helper and passed its packaged Qt visual smoke test
- Completed five consecutive native-window drag/release cycles without a crash or stale dragging state

### Update

Fully exit DSH, then run:

```powershell
dsh plugin --profile web update dsh-dafeiyu@alpha
```

Restart DSH after the update. The current DSH Host does not support replacing the whole plugin package while it is still running.

## 0.1.0-alpha.8

Packaging and DSH event-state hotfix release.

### Fixed

- Restored the Windows visual Helper after `0.1.0-alpha.7` was published without PySide6/Qt
- Stopped thinking-card copy from changing on every streamed assistant chunk ([#5](https://github.com/QCYTSN/dsh-dafeiyu/issues/5))
- Added real DSH `tool/result` call-ID paths so completed tools no longer leave stale working stages ([#6](https://github.com/QCYTSN/dsh-dafeiyu/issues/6))
- Added a dedicated waiting state for `ask_user_question`, `request_user_input`, and equivalent user-question tools ([#6](https://github.com/QCYTSN/dsh-dafeiyu/issues/6))

### Release safeguards

- The Windows build now fails before packaging unless the selected Python can import both PyInstaller and PySide6
- Every packaged Helper must start, complete the protocol handshake, render a real Qt snapshot with bundled assets, and shut down cleanly
- The public incident and resolution are tracked in [#7](https://github.com/QCYTSN/dsh-dafeiyu/issues/7)

### Update

Fully exit DSH, then run:

```powershell
dsh plugin --profile web update dsh-dafeiyu@alpha
```

Restart DSH after the update. Existing `0.1.0-alpha.7` users should update directly to this version.

## 0.1.0-alpha.7

> **Known broken release:** the published Windows Helper omitted PySide6/Qt. The WebUI settings
> panel loads, but the desktop companion cannot appear. Use `0.1.0-alpha.6` or update to
> `0.1.0-alpha.8`. See [#7](https://github.com/QCYTSN/dsh-dafeiyu/issues/7).

Animation and live-settings refinement release.

### Highlights

- 50 FPS standard rendering with 25 FPS retained for reduced-motion mode
- Subpixel positioning and smooth pixmap transforms for less stepped movement
- Short, non-flashing crossfades between larger pose and animation-frame changes
- Light procedural bob, sway, rotation, and breathing motion
- Multi-frame actions run roughly 10% faster while retaining readable character acting
- Independent live controls for character and status-card scale without restarting the Helper
- Live subagent preference changes preserve the active top-level project state

### Update

Fully exit DSH, then run:

```powershell
dsh plugin --profile web update dsh-dafeiyu@alpha
```

For a local DSH installation, run the equivalent command from its directory:

```powershell
pnpm exec dsh plugin --profile web update dsh-dafeiyu@alpha
```

Restart DSH after the update. Whole-package hot replacement is not supported by the current
DSH Host; live configuration changes remain available without restarting.

## 0.1.0-alpha.6

First public Windows Alpha of DSH BigFish / DSH 大肥鱼.

### Highlights

- Native transparent, frameless, always-on-top Windows companion owned by DSH
- Real DSH session states: idle, thinking, working, waiting, success, and error
- Project status card with project directory, current phase, active todo, and real todo progress
- Friendly Simplified Chinese status copy and 49-frame character runtime
- DSH WebUI settings for enable/disable, scale, activity, reduced motion, and subagents
- Helper heartbeat, crash restart, snapshot replay, and automatic exit with the DSH Host
- Bilingual Chinese/English GitHub documentation

### Install the Alpha

```powershell
dsh plugin --profile web add dsh-dafeiyu@alpha
```

If DSH is installed locally rather than globally:

```powershell
pnpm exec dsh plugin --profile web add dsh-dafeiyu@alpha
```

### Current limitations

- Windows 10/11 x64 only
- Settings and desktop status copy are currently Simplified Chinese
- Numeric progress requires a structured todo list from DSH
- Community Electron clients are not part of the supported compatibility scope

Code is MIT-licensed. Bundled character artwork has separate terms documented in
[ASSET_LICENSE.md](ASSET_LICENSE.md). This is an unofficial fan-made project and is not
affiliated with or endorsed by DeepSeek.
