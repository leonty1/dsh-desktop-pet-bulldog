<#
.SYNOPSIS
  Apply the Windows patch set to an installed dsh-frenchie, and install the
  companion plugin that adds the two sidebar-foot entries.

.DESCRIPTION
  Two steps, both reversible:
    1. the runtime patches in patches/ are applied to the profile's installed
       copy of dsh-frenchie (that copy is a package build, so a patch is the
       only way to fix the Qt Helper without shipping a fork);
    2. windows-patch/plugin is installed into the same profile as its own
       plugin, which is what puts the 宠物 / 设置 entries at the sidebar foot.

  The two runtime patches are the installable half of the set. The third patch
  (packaging) only matters in a clone of the repository, and is not applied here.

.PARAMETER Profile
  DSH profile name. The Electron desktop app uses "desktop", a WebUI install
  uses "web". Default: desktop.

.PARAMETER RebuildHelper
  Also rebuild the frozen Helper. The frame-size patch only reaches the desktop
  window through a rebuilt Helper, so this is required unless you build it
  yourself.

.PARAMETER Python
  Interpreter that can import PyInstaller and PySide6, passed to the Helper
  build. Default: the plugin's own build script decides (its .build/python-env,
  then `python` on PATH).

.PARAMETER Uninstall
  Reverse both steps: uninstall the companion plugin and revert the patches.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File windows-patch\install.ps1 -RebuildHelper
#>
param(
  [string]$Profile = 'desktop',
  [switch]$RebuildHelper,
  [string]$Python = '',
  [switch]$Uninstall
)

# Native tools report failure through stderr and an exit code; with 'Stop' those
# stderr lines abort the script, which would break the ordinary case of asking
# git whether a patch is already applied. Every native call below goes through
# Run-Native and its exit code is checked explicitly, so failures still stop
# with a message the caller can act on.
$ErrorActionPreference = 'Continue'

$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$companion = Join-Path $patchRoot 'plugin'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome (Join-Path 'profiles' $Profile)
$pluginDir = Join-Path $profileDir 'node_modules\dsh-frenchie'
$git = ''

function Fail([string]$Message) {
  Write-Host "windows-patch: $Message" -ForegroundColor Red
  exit 1
}

function Run-Native([string]$Command, [string[]]$Arguments) {
  $output = & $Command @Arguments 2>&1
  return @{
    Code = $LASTEXITCODE
    Text = (($output | Out-String).Trim())
  }
}

function Apply-Patch([string]$Patch, [switch]$Reverse) {
  $leaf = Split-Path -Leaf $Patch
  $probeArgs = if ($Reverse) { @('-C', $pluginDir, 'apply', '--reverse', '--check', $Patch) }
               else { @('-C', $pluginDir, 'apply', '--check', $Patch) }
  $probe = Run-Native $git $probeArgs
  if ($probe.Code -eq 0) {
    $doArgs = if ($Reverse) { @('-C', $pluginDir, 'apply', '--reverse', $Patch) }
              else { @('-C', $pluginDir, 'apply', $Patch) }
    $done = Run-Native $git $doArgs
    if ($done.Code -ne 0) {
      $verb = if ($Reverse) { 'revert' } else { 'apply' }
      Fail "could not $verb $leaf`: $($done.Text)"
    }
    if ($Reverse) { return 'reverted' }
    return 'applied'
  }
  # The probe failed: the opposite state may already be in place, which is not
  # an error (rerunning the script, or reverting something never applied).
  $otherArgs = if ($Reverse) { @('-C', $pluginDir, 'apply', '--check', $Patch) }
               else { @('-C', $pluginDir, 'apply', '--reverse', '--check', $Patch) }
  $other = Run-Native $git $otherArgs
  if ($other.Code -eq 0) {
    if ($Reverse) { return 'not applied' }
    return 'already applied'
  }
  Fail "$leaf does not apply cleanly: $($probe.Text)"
}

function Find-Dsh {
  $found = Get-Command dsh -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $bundled = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
  if (Test-Path -LiteralPath $bundled) { return $bundled }
  return $null
}

if (-not (Test-Path -LiteralPath $pluginDir)) {
  Fail "no dsh-frenchie in profile '$Profile' ($pluginDir). Install the plugin first, then run this script again."
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand) { Fail 'git was not found on PATH; apply the patches in patches/ by hand instead.' }
$git = $gitCommand.Source

# Patches that belong to the installed copy of the plugin. A clone takes these
# too, so they only ever touch files the package ships.
$installedPatchNames = @(
  '0001-qt-helper-logical-frame-size.patch',
  '0002-ship-runtime-asset-paths.patch'
)
# Repository-only patches: the packaging list and the ignore rule. An installed
# copy has no .gitignore and never reads `files`, so these are not applied here
# (a clone needs them so packing that clone keeps shipping the restored module).
$repositoryPatchNames = @('0003-packaging-includes-the-module.patch')

$patchDir = Join-Path $patchRoot 'patches'
$patches = @()
foreach ($name in $installedPatchNames) {
  $patch = Join-Path $patchDir $name
  if (-not (Test-Path -LiteralPath $patch)) { Fail "missing $name next to this script." }
  $patches += Get-Item -LiteralPath $patch
}

Write-Host "windows-patch: profile   $Profile"
Write-Host "windows-patch: pet copy  $pluginDir"
Write-Host "windows-patch: patches   $($patches.Count) of $($installedPatchNames.Count + $repositoryPatchNames.Count) runtime patches (the rest are repository-only)"
Write-Host ''

if ($Uninstall) {
  Write-Host '== reverting the runtime patches =='
  foreach ($patch in $patches) {
    $state = Apply-Patch $patch.FullName -Reverse
    Write-Host "   $($patch.Name): $state"
  }

  Write-Host ''
  Write-Host '== removing the companion plugin =='
  $dsh = Find-Dsh
  if ($dsh) {
    $removed = Run-Native $dsh @('plugin', '--profile', $Profile, 'remove', 'dsh-frenchie-windows')
    if ($removed.Code -ne 0) { Write-Host "   the package manager refused: $($removed.Text)" -ForegroundColor Yellow }
  }
  else {
    Write-Host "   no dsh command found; run: dsh plugin --profile $Profile remove dsh-frenchie-windows"
  }
  Write-Host ''
  Write-Host 'windows-patch: done. Restart DSH (or reload the page) to drop the entries.'
  exit 0
}

Write-Host '== applying the runtime patches =='
foreach ($patch in $patches) {
  $state = Apply-Patch $patch.FullName
  Write-Host "   $($patch.Name): $state"
}

Write-Host ''
Write-Host '== installing the companion plugin =='
$dsh = Find-Dsh
if ($dsh) {
  $installed = Run-Native $dsh @('plugin', '--profile', $Profile, 'add', $companion)
  if ($installed.Code -ne 0) {
    Write-Host "   the plugin install failed: $($installed.Text)" -ForegroundColor Yellow
    Write-Host "   retry by hand: dsh plugin --profile $Profile add `"$companion`""
  }
}
else {
  Write-Host '   no dsh command found; install it by hand:' -ForegroundColor Yellow
  Write-Host "   dsh plugin --profile $Profile add `"$companion`""
}

Write-Host ''
if ($RebuildHelper) {
  Write-Host '== rebuilding the frozen Helper =='
  if ($Python) { $env:DSH_DAFEIYU_BUILD_PYTHON = $Python }
  # `npm` is frequently absent on the machines this patch set is for, and the
  # launcher named `node.cmd` next to a Desktop runtime is a shim that only
  # works inside DSH (it expands a variable DSH sets for its children). A real
  # node.exe that DSH downloaded for its own runtimes is a usable fallback, and
  # it has to go on PATH because the plugin's build script calls bare `node`
  # for its smoke test.
  function Find-Node {
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    if ($onPath -and $onPath.Source -notlike '*.cmd') { return $onPath.Source }
    $candidates = @(
      (Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe')
    )
    foreach ($candidate in $candidates) {
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
  }

  $savedPath = $env:PATH
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  $nodePath = Find-Node
  # PyInstaller runs with --noconfirm, so a build that fails after it starts can
  # leave the install without the Helper it had before. Keep a copy and put it
  # back when that happens.
  $exePath = Join-Path $pluginDir 'runtime\bin\win32-x64\dsh-frenchie-helper.exe'
  $exeBackup = "$exePath.pre-rebuild"
  $hadExe = Test-Path -LiteralPath $exePath
  if ($hadExe) { Copy-Item -LiteralPath $exePath -Destination $exeBackup -Force }
  $buildCode = 0
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $pluginDir 'scripts\build-helper.mjs'))) {
      Write-Host '   this copy ships no build script (a packed install can omit it); build the' -ForegroundColor Yellow
      Write-Host '   Helper from a clone with `npm run build:helper` instead.' -ForegroundColor Yellow
    }
    elseif ($npm) {
      Push-Location $pluginDir
      try { $built = Run-Native $npm.Source @('run', 'build:helper') } finally { Pop-Location }
      $buildCode = $built.Code
      if ($buildCode -ne 0) { Write-Host "   the Helper build failed: $($built.Text)" -ForegroundColor Yellow }
      else { Write-Host '   Helper rebuilt.' }
    }
    elseif ($nodePath) {
      $env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
      Push-Location $pluginDir
      try { $built = Run-Native $nodePath @('scripts/build-helper.mjs') } finally { Pop-Location }
      $buildCode = $built.Code
      if ($buildCode -ne 0) { Write-Host "   the Helper build failed: $($built.Text)" -ForegroundColor Yellow }
      else { Write-Host '   Helper rebuilt.' }
    }
    else {
      Write-Host '   no node was found on PATH or in the DSH runtimes; the build needs Node plus a' -ForegroundColor Yellow
      Write-Host '   Python carrying PyInstaller and PySide6 (pass that one with -Python).' -ForegroundColor Yellow
    }
  }
  finally { $env:PATH = $savedPath }

  if ($hadExe -and -not (Test-Path -LiteralPath $exePath)) {
    Copy-Item -LiteralPath $exeBackup -Destination $exePath -Force
    Write-Host '   the build removed the Helper without producing one; the previous exe is back.' -ForegroundColor Yellow
  }
  if (Test-Path -LiteralPath $exeBackup) { Remove-Item -LiteralPath $exeBackup -Force }
}
else {
  $helperDir = Join-Path $pluginDir 'runtime\bin\win32-x64'
  if (Test-Path -LiteralPath $helperDir) {
    Write-Host 'note: the Helper is a frozen build, so the frame-size patch only takes effect after' -ForegroundColor Yellow
    Write-Host 'note: rebuilding it - rerun this script with -RebuildHelper.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'windows-patch: done.'
Write-Host 'Fully quit DSH and start it again: the two entries, the settings panel and the'
Write-Host 'rebuilt Helper all appear on the next start. A page reload alone shows the entries.'
Write-Host ''
Write-Host "note: $($repositoryPatchNames -join ', ') is repository-only (the package manifest"
Write-Host 'note: and the ignore list). Apply it in your clone of the plugin before packing a'
Write-Host 'note: release from there: git apply windows-patch/patches/*.patch'
