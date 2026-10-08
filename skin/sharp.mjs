// sharp, for the one script every image tool here needs it for.
//
// The pipeline reaches sharp two different ways: run from the plugin itself it is a dev
// dependency in this directory's `node_modules`, and run from inside the harness workspace
// it is only a transitive dependency, reachable through the pnpm store several levels above.
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))

/** The sharp inside the nearest pnpm store above this directory, or null. */
function fromStore() {
  for (let depth = 1; depth <= 5; depth++) {
    const store = join(HERE, ...Array(depth).fill('..'), 'node_modules', '.pnpm')
    let names
    try {
      names = readdirSync(store)
    } catch {
      continue
    }
    const held = names.find((name) => name.startsWith('sharp@'))
    if (held) return require(join(store, held, 'node_modules', 'sharp'))
  }
  return null
}

function load() {
  try {
    return require('sharp')
  } catch {
    const store = fromStore()
    if (store) return store
  }
  throw new Error('The skin pipeline needs sharp: run npm install in the plugin directory first.')
}

export const sharp = load()
