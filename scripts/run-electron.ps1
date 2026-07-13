$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronRoot = Join-Path $projectRoot "ElectronOverlay"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")
$backendUrl = if ($env:LYRIKANA_BACKEND_URL) {
    $env:LYRIKANA_BACKEND_URL.TrimEnd("/")
} else {
    "http://127.0.0.1:8000"
}

$deadline = (Get-Date).AddSeconds(30)
$delayMilliseconds = 250
$backendReady = $false

while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-RestMethod -Uri "$backendUrl/health" -TimeoutSec 2
        if ($health.status -eq "ok") {
            $backendReady = $true
            break
        }
    } catch {
        # The parallel backend task may still be loading its environment.
    }

    Start-Sleep -Milliseconds $delayMilliseconds
    $delayMilliseconds = [Math]::Min(2000, [Math]::Round($delayMilliseconds * 1.6))
}

if ($backendReady) {
    Write-Host "[LyriKana] Backend health check passed."
} else {
    Write-Warning "Backend did not become ready within 30 seconds. Starting the overlay in reconnect mode."
}

Push-Location $electronRoot
try {
    & npm.cmd run dev
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
