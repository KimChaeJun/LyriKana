$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "LyriKana automatic Electron launch currently supports Windows only."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "native-host\Launcher.cs"
$binDirectory = Join-Path $projectRoot "native-host\bin"
$launcherPath = Join-Path $binDirectory "LyriKanaNativeHost.exe"
$hostManifestPath = Join-Path $binDirectory "com.lyrikana.launcher.json"
$extensionManifestPath = Join-Path $projectRoot "Extension\public\manifest.json"

New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
}

$source = Get-Content -Raw -LiteralPath $sourcePath -Encoding UTF8
Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $launcherPath -OutputType WindowsApplication

$extensionManifest = Get-Content -Raw -LiteralPath $extensionManifestPath -Encoding UTF8 | ConvertFrom-Json
$publicKey = [Convert]::FromBase64String($extensionManifest.key)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $hash = $sha256.ComputeHash([byte[]]$publicKey)
} finally {
    $sha256.Dispose()
}

$alphabet = "abcdefghijklmnop"
$extensionId = New-Object System.Text.StringBuilder
for ($index = 0; $index -lt 16; $index++) {
    [void]$extensionId.Append($alphabet[[int]($hash[$index] -shr 4)])
    [void]$extensionId.Append($alphabet[[int]($hash[$index] -band 15)])
}

$hostManifest = @{
    name = "com.lyrikana.launcher"
    description = "Launches the LyriKana Electron overlay"
    path = $launcherPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$($extensionId.ToString())/")
} | ConvertTo-Json -Depth 4

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($hostManifestPath, $hostManifest, $utf8WithoutBom)

$registryPaths = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.lyrikana.launcher",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.lyrikana.launcher",
    "HKCU:\Software\Chromium\NativeMessagingHosts\com.lyrikana.launcher"
)

foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $hostManifestPath
}

Write-Host "[LyriKana] Native Host registered for extension $($extensionId.ToString())"
Write-Host "[LyriKana] Reload Extension/dist in chrome://extensions after rebuilding."
