[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $WebRoot,
    [Parameter(Mandatory)] [string] $PackageDirectory
)

$ErrorActionPreference = 'Stop'
$wwwroot = (Resolve-Path -LiteralPath $WebRoot).Path
$archives = (New-Item -ItemType Directory -Path $PackageDirectory -Force).FullName
$npmCache = Join-Path (Split-Path -Parent $PSScriptRoot) '.artifacts/npm'
$npm = if ($env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }

function Invoke-BuildCommand {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE." }
}

function Replace-Text {
    param([string] $Path, [string] $OldText, [string] $NewText)
    $content = [IO.File]::ReadAllText($Path)
    if (!$content.Contains($OldText)) { throw "Expected text was missing in $Path." }
    [IO.File]::WriteAllText($Path, $content.Replace($OldText, $NewText))
}

$netplay = Get-Content -Raw -LiteralPath (Join-Path $wwwroot 'netplay.js')
$version = [regex]::Match($netplay, 'const EJS_VERSION = "([^"]+)";').Groups[1].Value
$index = Join-Path $wwwroot 'index.html'
$peerUrl = [regex]::Match([IO.File]::ReadAllText($index), 'https://cdn\.jsdelivr\.net/npm/peerjs@([^/]+)/dist/peerjs\.min\.js')
if (!$version -or !$peerUrl.Success) { throw 'Could not find the pinned EmulatorJS and PeerJS versions.' }
$peerVersion = $peerUrl.Groups[1].Value
$cores = @('genesis_plus_gx', 'picodrive', 'snes9x', 'fceumm', 'nestopia')
$packages = @("@emulatorjs/emulatorjs@$version", "peerjs@$peerVersion")
$packages += $cores | ForEach-Object { "@emulatorjs/core-$_@$version" }
Invoke-BuildCommand $npm (@('pack', '--silent', '--prefer-offline', '--cache', $npmCache, '--pack-destination', $archives) + $packages)

$vendor = Join-Path $wwwroot 'vendor'
$emulator = (New-Item -ItemType Directory -Path (Join-Path $vendor "emulatorjs/$version") -Force).FullName
$peer = (New-Item -ItemType Directory -Path (Join-Path $vendor "peerjs/$peerVersion") -Force).FullName
Invoke-BuildCommand tar @('-xf', (Join-Path $archives "emulatorjs-emulatorjs-$version.tgz"), '-C', $emulator, '--strip-components', '1', 'package/data', 'package/LICENSE')
Invoke-BuildCommand tar @('-xf', (Join-Path $archives "peerjs-$peerVersion.tgz"), '-C', $peer, '--strip-components', '1', 'package/dist/peerjs.min.js', 'package/LICENSE')
$coreDir = (New-Item -ItemType Directory -Path (Join-Path $emulator 'data/cores') -Force).FullName
Move-Item -LiteralPath (Join-Path $coreDir 'README.md') -Destination (Join-Path $coreDir 'emulatorjs-cores-README.md')
foreach ($core in $cores) {
    $coreArchive = Join-Path $archives "emulatorjs-core-$core-$version.tgz"
    $coreFiles = @('wasm', 'legacy-wasm', 'thread-wasm', 'thread-legacy-wasm') | ForEach-Object { "package/$core-$_.data" }
    Invoke-BuildCommand tar (@('-xf', $coreArchive, '-C', $coreDir, '--strip-components', '1', "package/reports/$core.json", 'package/README.md') + $coreFiles)
    Move-Item -LiteralPath (Join-Path $coreDir 'README.md') -Destination (Join-Path $coreDir "$core-README.md")
}

# The npm package ships the individual scripts and CSS.
Replace-Text (Join-Path $emulator 'data/loader.js') '("undefined" != typeof EJS_DEBUG_XX && true === EJS_DEBUG_XX)' '(true)'
$emulatorScript = Join-Path $emulator 'data/src/emulator.js'
Replace-Text $emulatorScript 'if (this.debug || (window.location && ["localhost", "127.0.0.1"].includes(location.hostname))) this.checkForUpdates();' '// Update checks are disabled when the emulator is bundled with the player.'
$source = [IO.File]::ReadAllText($emulatorScript)
$fallback = [regex]::Match($source, '(?s)if \(res === -1\) \{\s*console\.log\("File not found, attemping to fetch from emulatorjs cdn\."\);.*?\r?\n(\s*)\}\r?\n\s*gotCore\(res\.data\);')
if (!$fallback.Success) { throw 'Could not find the upstream core CDN fallback.' }
$indent = $fallback.Groups[1].Value
$localFailure = @"
if (res === -1) {
${indent}    this.startGameError("Bundled core could not be loaded (" + filename + ").");
${indent}    return;
${indent}}
${indent}gotCore(res.data);
"@
Replace-Text $emulatorScript $fallback.Value $localFailure
Replace-Text $index $peerUrl.Value "vendor/peerjs/$peerVersion/dist/peerjs.min.js"
Replace-Text $index '<script src="netplay.js">' ('<script src="netplay.js" data-emulator-data="vendor/emulatorjs/{0}/data/">' -f $version)
