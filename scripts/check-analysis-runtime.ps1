param(
    [ValidateRange(0.5, 10.0)]
    [double]$Seconds = 2.0
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")
$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
$analysisPython = Join-Path $backendRoot ".venv-analysis\Scripts\python.exe"
$separator = Join-Path $backendRoot ".venv-analysis\Scripts\audio-separator.exe"
$modelDirectory = Join-Path $backendRoot ".analysis-data\models"
$toolDirectory = Join-Path $backendRoot ".analysis-tools"

foreach ($required in @($python, $analysisPython, $separator, (Join-Path $toolDirectory "ffmpeg.exe"))) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Analysis runtime file missing: $required. Run scripts/setup-analysis.ps1 first."
    }
}

$env:ANALYSIS_SEPARATOR = "audio_separator"
$env:ANALYSIS_SEPARATOR_COMMAND = $separator
$env:ANALYSIS_SEPARATOR_MODEL = if ($env:ANALYSIS_SEPARATOR_MODEL) {
    $env:ANALYSIS_SEPARATOR_MODEL
} else {
    "UVR-MDX-NET-Inst_HQ_3.onnx"
}
$env:ANALYSIS_MODEL_DIR = $modelDirectory
$env:ANALYSIS_FFMPEG_DIR = $toolDirectory
$env:AUDIO_SEPARATOR_MODEL_DIR = $modelDirectory
$env:PATH = "$toolDirectory;$env:PATH"

$runtimeSummary = & $analysisPython -c "import json, sys, torch, transformers, onnxruntime as ort; providers=ort.get_available_providers(); ready=torch.cuda.is_available() and 'CUDAExecutionProvider' in providers; print(json.dumps({'torch': torch.__version__, 'torchCuda': torch.version.cuda, 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, 'transformers': transformers.__version__, 'onnxProviders': providers})); sys.exit(0 if ready else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "CUDA or ONNX Runtime GPU provider is unavailable: $runtimeSummary"
}
Write-Host $runtimeSummary

Push-Location $backendRoot
try {
    & $python -m app.analysis_runtime_check --seconds $Seconds
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
