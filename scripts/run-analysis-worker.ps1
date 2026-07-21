$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")
$backendPython = Join-Path $backendRoot ".venv\Scripts\python.exe"
$rootPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$analysisSeparator = Join-Path $backendRoot ".venv-analysis\Scripts\audio-separator.exe"
$analysisModelDirectory = Join-Path $backendRoot ".analysis-data\models"
$analysisToolDirectory = Join-Path $backendRoot ".analysis-tools"

if (Test-Path -LiteralPath $backendPython) {
    $python = $backendPython
} elseif (Test-Path -LiteralPath $rootPython) {
    $python = $rootPython
} else {
    $python = (Get-Command python -ErrorAction Stop).Source
}

if ((-not $env:ANALYSIS_SEPARATOR_COMMAND -or $env:ANALYSIS_SEPARATOR_COMMAND -eq "audio-separator") -and (Test-Path -LiteralPath $analysisSeparator)) {
    $env:ANALYSIS_SEPARATOR_COMMAND = $analysisSeparator
}
if (-not $env:ANALYSIS_MODEL_DIR) {
    $env:ANALYSIS_MODEL_DIR = $analysisModelDirectory
}
$env:AUDIO_SEPARATOR_MODEL_DIR = $env:ANALYSIS_MODEL_DIR
if (Test-Path -LiteralPath (Join-Path $analysisToolDirectory "ffmpeg.exe")) {
    $env:PATH = "$analysisToolDirectory;$env:PATH"
}

Push-Location $backendRoot
try {
    & $python -m app.analysis_worker
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
