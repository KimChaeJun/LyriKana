param(
    [ValidateSet("gpu", "cpu")]
    [string]$Runtime = "gpu",
    [string]$Model = "UVR-MDX-NET-Inst_HQ_3.onnx",
    [string]$AlignerModel = "prj-beatrice/japanese-hubert-base-phoneme-ctc-v4"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot "backend"
$environmentRoot = Join-Path $backendRoot ".venv-analysis"
$environmentPython = Join-Path $environmentRoot "Scripts\python.exe"
$modelDirectory = Join-Path $backendRoot ".analysis-data\models"
$alignerCacheDirectory = Join-Path $backendRoot ".analysis-data\huggingface"
$toolDirectory = Join-Path $backendRoot ".analysis-tools"
$ffmpegCommand = Join-Path $toolDirectory "ffmpeg.exe"

if (-not (Test-Path -LiteralPath $environmentPython)) {
    $systemPython = (Get-Command python -ErrorAction Stop).Source
    & $systemPython -m venv $environmentRoot
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the analysis environment." }
}

& $environmentPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip." }

$separatorPackage = "audio-separator[$Runtime]==0.44.2"
& $environmentPython -m pip install $separatorPackage
if ($LASTEXITCODE -ne 0) { throw "Failed to install audio-separator." }

if ($Runtime -eq "gpu") {
    $torchCudaReady = & $environmentPython -c "import torch; print('yes' if torch.cuda.is_available() else 'no')"
    if ($torchCudaReady -ne "yes") {
        & $environmentPython -m pip install --force-reinstall --no-deps `
            "torch==2.13.0+cu130" "torchvision==0.28.0+cu130" `
            --index-url "https://download.pytorch.org/whl/cu130"
        if ($LASTEXITCODE -ne 0) { throw "Failed to install CUDA-enabled PyTorch." }
    }
    & $environmentPython -c "import torch, sys; print(f'[LyriKana] Torch {torch.__version__}, CUDA {torch.version.cuda}, GPU {torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}'); sys.exit(0 if torch.cuda.is_available() else 1)"
    if ($LASTEXITCODE -ne 0) { throw "CUDA is not available in the analysis environment." }
}

& $environmentPython -m pip install "imageio-ffmpeg==0.6.0"
if ($LASTEXITCODE -ne 0) { throw "Failed to install the local FFmpeg runtime." }

& $environmentPython -m pip install "transformers==5.14.1"
if ($LASTEXITCODE -ne 0) { throw "Failed to install the Japanese CTC aligner runtime." }

New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
$imageioBinaryDirectory = Join-Path $environmentRoot "Lib\site-packages\imageio_ffmpeg\binaries"
$bundledFfmpeg = Get-ChildItem -LiteralPath $imageioBinaryDirectory -Filter "ffmpeg-*.exe" |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $bundledFfmpeg -or -not (Test-Path -LiteralPath $bundledFfmpeg)) {
    throw "Could not locate the bundled FFmpeg executable."
}
Copy-Item -LiteralPath $bundledFfmpeg -Destination $ffmpegCommand -Force
$env:PATH = "$toolDirectory;$env:PATH"

$separatorCommand = Join-Path $environmentRoot "Scripts\audio-separator.exe"
New-Item -ItemType Directory -Force -Path $modelDirectory | Out-Null
$env:AUDIO_SEPARATOR_MODEL_DIR = $modelDirectory

& $separatorCommand --env_info
if ($LASTEXITCODE -ne 0) { throw "audio-separator environment check failed." }

& $separatorCommand --download_model_only -m $Model --model_file_dir $modelDirectory
if ($LASTEXITCODE -ne 0) { throw "Failed to download the initial separator model." }

New-Item -ItemType Directory -Force -Path $alignerCacheDirectory | Out-Null
$env:HF_HOME = $alignerCacheDirectory
$env:LYRIKANA_CTC_MODEL = $AlignerModel
& $environmentPython -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id=os.environ['LYRIKANA_CTC_MODEL'], cache_dir=os.environ['HF_HOME'], allow_patterns=['*.json', '*.txt', '*.safetensors'])"
if ($LASTEXITCODE -ne 0) { throw "Failed to download the Japanese CTC aligner model." }

Write-Host "[LyriKana] Analysis separator ready: $separatorCommand"
Write-Host "[LyriKana] Local FFmpeg ready: $ffmpegCommand"
Write-Host "[LyriKana] Initial model ready: $Model"
Write-Host "[LyriKana] Japanese CTC aligner ready: $AlignerModel"
Write-Host "[LyriKana] Singing-specific fine-tuning remains a separate benchmark stage; see docs/karaoke-analysis-pipeline.md."
