$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot "backend\.venv\Scripts\python.exe"

Push-Location (Join-Path $projectRoot "backend")
try {
    & $python -m pytest
    if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
} finally {
    Pop-Location
}

Push-Location (Join-Path $projectRoot "Extension")
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Extension tests failed." }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Extension build failed." }
} finally {
    Pop-Location
}

Push-Location (Join-Path $projectRoot "lyrikana-data-core")
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Data core build failed." }
} finally {
    Pop-Location
}

Write-Host "[LyriKana] All tests and builds passed."
