[CmdletBinding()]
param(
    [string[]] $NuGetSource = @()
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $repo '.artifacts'
$stage = Join-Path $artifacts ('portable-' + [Guid]::NewGuid().ToString('N'))
$publish = Join-Path $stage 'Emulator-Online-Multiplayer'
$archives = Join-Path $stage 'packages'
$npmCache = Join-Path $artifacts 'npm'
New-Item -ItemType Directory -Path $archives -Force | Out-Null

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

$project = Join-Path $repo 'src/Server/Server/Server.csproj'
$publishArgs = @('publish', $project, '-c', 'Release', '-r', 'win-x64', '--self-contained', '--artifacts-path', (Join-Path $stage 'build'), '-o', $publish)
foreach ($source in $NuGetSource) { $publishArgs += @('--source', $source) }
Invoke-BuildCommand dotnet $publishArgs

$wwwroot = Join-Path $publish 'wwwroot'
$netplay = Get-Content -Raw -LiteralPath (Join-Path $wwwroot 'netplay.js')
$version = [regex]::Match($netplay, 'const EJS_VERSION = "([^"]+)";').Groups[1].Value
$index = Join-Path $wwwroot 'index.html'
$peerUrl = [regex]::Match([IO.File]::ReadAllText($index), 'https://cdn\.jsdelivr\.net/npm/peerjs@([^/]+)/dist/peerjs\.min\.js')
if (!$version -or !$peerUrl.Success) { throw 'Could not find the pinned EmulatorJS and PeerJS versions.' }
$peerVersion = $peerUrl.Groups[1].Value
$cores = @('genesis_plus_gx', 'picodrive', 'snes9x', 'fceumm', 'nestopia')
$packages = @("@emulatorjs/emulatorjs@$version", "peerjs@$peerVersion")
$packages += $cores | ForEach-Object { "@emulatorjs/core-$_@$version" }
Invoke-BuildCommand npm.cmd (@('pack', '--silent', '--prefer-offline', '--cache', $npmCache, '--pack-destination', $archives) + $packages)

$vendor = Join-Path $wwwroot 'vendor'
$emulator = (New-Item -ItemType Directory -Path (Join-Path $vendor "emulatorjs/$version") -Force).FullName
$peer = (New-Item -ItemType Directory -Path (Join-Path $vendor "peerjs/$peerVersion") -Force).FullName
Invoke-BuildCommand tar.exe @('-xf', (Join-Path $archives "emulatorjs-emulatorjs-$version.tgz"), '-C', $emulator, '--strip-components', '1', 'package/data', 'package/LICENSE')
Invoke-BuildCommand tar.exe @('-xf', (Join-Path $archives "peerjs-$peerVersion.tgz"), '-C', $peer, '--strip-components', '1', 'package/dist/peerjs.min.js', 'package/LICENSE')
$coreDir = (New-Item -ItemType Directory -Path (Join-Path $emulator 'data/cores') -Force).FullName
Move-Item -LiteralPath (Join-Path $coreDir 'README.md') -Destination (Join-Path $coreDir 'emulatorjs-cores-README.md')
foreach ($core in $cores) {
    $coreArchive = Join-Path $archives "emulatorjs-core-$core-$version.tgz"
    $coreFiles = @('wasm', 'legacy-wasm', 'thread-wasm', 'thread-legacy-wasm') | ForEach-Object { "package/$core-$_.data" }
    Invoke-BuildCommand tar.exe (@('-xf', $coreArchive, '-C', $coreDir, '--strip-components', '1', "package/reports/$core.json", 'package/README.md') + $coreFiles)
    Move-Item -LiteralPath (Join-Path $coreDir 'README.md') -Destination (Join-Path $coreDir "$core-README.md")
}

# The npm package ships the individual scripts and CSS.
Replace-Text (Join-Path $emulator 'data/loader.js') '("undefined" != typeof EJS_DEBUG_XX && true === EJS_DEBUG_XX)' '(true)'
$emulatorScript = Join-Path $emulator 'data/src/emulator.js'
Replace-Text $emulatorScript 'if (this.debug || (window.location && ["localhost", "127.0.0.1"].includes(location.hostname))) this.checkForUpdates();' '// Update checks are disabled in the portable build.'
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

Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination $publish
foreach ($mode in @('Player', 'Relay', 'Mobile')) {
    $launcher = if ($mode -eq 'Mobile') { 'Mobile Host' } else { $mode }
    @"
@echo off
cd /d "%~dp0"
Server.exe --RunMode=$mode
if errorlevel 1 pause
"@ | Set-Content -Encoding ASCII -LiteralPath (Join-Path $publish "Launch $launcher.cmd")
}
@'
1. Each player extracts the ZIP, opens Launch Player.cmd, and visits
   http://localhost:5280 on their own PC.
2. Keep Cloudflare Worker relay selected for internet play.
3. On both PCs, enter the same room code, core and ROM, then press Join.

For LAN play, start Launch Relay.cmd on the relay PC (port 5279).
Choose Server relay on both players. Use the relay's reachable address,
such as http://192.168.1.6:5279 on a LAN. Leave the address blank if
the relay runs on the same PC as the player.

Keep the launchers and game tabs open while playing. Each player loads
EmulatorJS and the cores from their own extracted files.

To play on a phone, run Launch Mobile Host.cmd on the PC in place of
Launch Relay.cmd. On the same Wi-Fi, open the printed phone URL in the
phone's browser. Choose the ROM from the phone's files and use the on-screen
controls. The first visit loads the emulator from the PC into browser cache.
'@ | Set-Content -Encoding ASCII -LiteralPath (Join-Path $publish 'Start here.txt')

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $stage 'Emulator-Online-Multiplayer-win-x64.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($publish, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
$output = Join-Path $artifacts (Split-Path -Leaf $zip)
Move-Item -Force -LiteralPath $zip -Destination $output
Write-Output "Portable ZIP: $output"
