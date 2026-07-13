$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
$venvPython = Join-Path $backendRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".env"))) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination (Join-Path $projectRoot ".env")
    Write-Host "[LyriKana] Created .env from .env.example"
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    $systemPython = (Get-Command python -ErrorAction Stop).Source
    & $systemPython -m venv (Join-Path $backendRoot ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
}

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip." }
& $venvPython -m pip install -r (Join-Path $backendRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Failed to install Python dependencies." }

foreach ($directory in @("Extension", "ElectronOverlay", "lyrikana-data-core")) {
    Push-Location (Join-Path $projectRoot $directory)
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $directory." }
    } finally {
        Pop-Location
    }
}

Push-Location $backendRoot
try {
    & $venvPython -c "from app.database import init_database; init_database(); print('[LyriKana] Database ready')"
    if ($LASTEXITCODE -ne 0) { throw "Failed to initialize the database." }
} finally {
    Pop-Location
}

Write-Host "[LyriKana] Setup complete. Press F5 and select 'LyriKana: Full Development'."
