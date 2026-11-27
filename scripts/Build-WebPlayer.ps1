[CmdletBinding()]
param(
    [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repo ('.artifacts/web-' + [Guid]::NewGuid().ToString('N'))
if (!$OutputDirectory) {
    $OutputDirectory = Join-Path $stage 'site'
}

if (Test-Path -LiteralPath $OutputDirectory) {
    throw "The output directory already exists: $OutputDirectory"
}

$site = (New-Item -ItemType Directory -Path $OutputDirectory).FullName
$source = Join-Path $repo 'src/Server/Server/wwwroot'
Copy-Item -Path (Join-Path $source '*') -Destination $site -Recurse
& (Join-Path $PSScriptRoot 'Bundle-PlayerAssets.ps1') -WebRoot $site -PackageDirectory (Join-Path $stage 'packages')
Write-Output "Web player: $site"
