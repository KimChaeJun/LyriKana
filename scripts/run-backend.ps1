$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")
$backendPython = Join-Path $backendRoot ".venv\Scripts\python.exe"
$rootPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (Test-Path -LiteralPath $backendPython) {
    $python = $backendPython
} elseif (Test-Path -LiteralPath $rootPython) {
    $python = $rootPython
} else {
    $python = (Get-Command python -ErrorAction Stop).Source
}

$hostAddress = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$portNumber = if ($env:PORT) { $env:PORT } else { "8000" }

Push-Location $backendRoot
try {
    & $python -m uvicorn app.main:app --reload --host $hostAddress --port $portNumber
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
