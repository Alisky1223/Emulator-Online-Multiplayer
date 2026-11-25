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

function Invoke-BuildCommand {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE." }
}

$project = Join-Path $repo 'src/Server/Server/Server.csproj'
$publishArgs = @('publish', $project, '-c', 'Release', '-r', 'win-x64', '--self-contained', '--artifacts-path', (Join-Path $stage 'build'), '-o', $publish)
foreach ($source in $NuGetSource) { $publishArgs += @('--source', $source) }
Invoke-BuildCommand dotnet $publishArgs

$wwwroot = Join-Path $publish 'wwwroot'
& (Join-Path $PSScriptRoot 'Bundle-PlayerAssets.ps1') -WebRoot $wwwroot -PackageDirectory $archives

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
