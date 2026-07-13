$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot "Extension"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")

Push-Location $extensionRoot
try {
    & npm.cmd run dev
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
