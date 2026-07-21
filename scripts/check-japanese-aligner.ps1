param(
    [switch]$ForceDownload
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
. (Join-Path $PSScriptRoot "load-env.ps1") -Path (Join-Path $projectRoot ".env")
$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
$analysisPython = Join-Path $backendRoot ".venv-analysis\Scripts\python.exe"
$aligner = Join-Path $backendRoot "aligners\japanese_ctc_aligner.py"
$benchmarkDirectory = Join-Path $backendRoot ".analysis-data\benchmarks\pjs"
$audio = Join-Path $benchmarkDirectory "pjs056_song.wav"
$labels = Join-Path $benchmarkDirectory "pjs056.lab"
$result = Join-Path $benchmarkDirectory "alignment-benchmark.json"
$cache = Join-Path $backendRoot ".analysis-data\huggingface"

foreach ($required in @($python, $analysisPython, $aligner)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Japanese aligner runtime file missing: $required. Run scripts/setup-analysis.ps1 first."
    }
}

New-Item -ItemType Directory -Force -Path $benchmarkDirectory | Out-Null
if ($ForceDownload -or -not (Test-Path -LiteralPath $audio)) {
    Invoke-WebRequest `
        -Uri "https://drive.usercontent.google.com/download?id=1NJ3_xuUFPRUfpI276yce1mcsHPpVdoCM&export=download&confirm=t" `
        -OutFile $audio
}
if ($ForceDownload -or -not (Test-Path -LiteralPath $labels)) {
    Invoke-WebRequest `
        -Uri "https://raw.githubusercontent.com/UtaUtaUtau/pjs-manual-labels/main/lab/pjs056.lab" `
        -OutFile $labels
}
if ((Get-Item -LiteralPath $audio).Length -lt 10000) {
    throw "PJS sample download is unexpectedly small: $audio"
}

$env:ANALYSIS_CTC_PYTHON = $analysisPython
$env:ANALYSIS_CTC_SCRIPT = $aligner
$env:ANALYSIS_CTC_CACHE_DIR = $cache
$env:HF_HOME = $cache
$lyricsBytes = [Convert]::FromBase64String("44Go44GT44KN44GM44CB44Ko44Oq44Ol44K344Kv44OI44O844Oz44Gv44CB44OL44Ol44Og44Oa44O844Gu5Yi25q2i44KC6IGe44GL44Ga44Gr44CB44OH44O844Oh44O844OG44O844Or44Gu5qir44KS5YiH44KK5YCS44GX44Gf")
$lyrics = [Text.Encoding]::UTF8.GetString($lyricsBytes)

Push-Location $backendRoot
try {
    & $python -m app.alignment_benchmark `
        --audio $audio `
        --labels $labels `
        --lyrics $lyrics `
        --output $result
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
