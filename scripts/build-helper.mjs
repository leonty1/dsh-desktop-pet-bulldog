import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preparing = process.argv.includes('--prepare')
const launch = process.platform === 'win32'
  ? {
      command: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts', 'build-helper.ps1')],
    }
  : process.platform === 'linux'
    ? { command: 'bash', args: [resolve(root, 'scripts', 'build-helper.sh')] }
    : process.platform === 'darwin'
      ? { command: 'bash', args: [resolve(root, 'native', 'macos', 'build.sh')] }
    : undefined

// Only the macOS Helper builds from what an install already has: swiftc, which Command Line
// Tools put on every Apple machine. The Qt Helper needs a Python interpreter with PyInstaller
// and PySide6, and that takes minutes to fetch and freeze — a package install that spends it
// silently, and fails the profile when the toolchain is missing, is worse than one line of
// instruction. `--prepare` is the install hook; `npm run build:helper` stays the explicit
// build on every platform.
if (preparing && process.platform !== 'darwin') {
  console.log(
    'dsh-frenchie: the Windows/Linux Helper is not built during install. '
    + 'Run `npm run build:helper` in the plugin directory, or install Python and PySide6 '
    + 'and the plugin will run runtime/helper.py from source.',
  )
  process.exit(0)
}

if (!launch) {
  throw new Error(`Helper builds are not configured for ${process.platform}/${process.arch}`)
}

const child = spawn(launch.command, launch.args, { cwd: root, stdio: 'inherit' })
child.once('error', (error) => {
  console.error(`Unable to start the Helper build: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
