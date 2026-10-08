// The sprite frames the Helper draws, baked from the masters in skin/ when they are missing.
//
// `assets/pet/` holds 1240 webp files — 37 MB, and every one of them is derived from the three
// masters under `skin/poses/`, so they are build output and stay out of git the same way
// `runtime/bin/` does. A clone or an installed package gets them from here: `prepare` calls this
// before it builds the Helper, and an existing set is left alone.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shippedManifest = join(root, 'assets', 'pet-manifest.json')
const bakedManifest = join(root, 'skin', 'pet-manifest.json')
const framesDir = join(root, 'assets', 'pet')

/** The frame paths the manifest names, relative to `assets/pet/`. */
function requiredFrames(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return Object.values(manifest.clips).flatMap((clip) => clip.frames)
}

function complete() {
  if (!existsSync(shippedManifest)) return false
  return requiredFrames(shippedManifest).every((frame) => existsSync(join(framesDir, frame)))
}

if (complete()) {
  console.log(`dsh-frenchie: ${requiredFrames(shippedManifest).length} sprite frames already in assets/pet`)
} else {
  const bake = spawnSync(process.execPath, [join(root, 'skin', 'build-sprites.mjs'), 'all'], { cwd: root, stdio: 'inherit' })
  if (bake.status !== 0) {
    console.error('dsh-frenchie: the skin pipeline could not bake the sprite frames.')
    process.exit(bake.status ?? 1)
  }
  rmSync(framesDir, { recursive: true, force: true })
  cpSync(join(root, 'skin', 'frames'), framesDir, { recursive: true })
  cpSync(bakedManifest, shippedManifest)
  console.log(`dsh-frenchie: baked ${requiredFrames(shippedManifest).length} sprite frames into assets/pet`)
}
