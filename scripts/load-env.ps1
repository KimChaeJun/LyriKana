param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

if (-not (Test-Path -LiteralPath $Path)) {
    return
}

foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
        continue
    }

    $name, $value = $trimmed.Split("=", 2)
    $name = $name.Trim()
    if (-not $name -or [Environment]::GetEnvironmentVariable($name, "Process")) {
        continue
    }

    [Environment]::SetEnvironmentVariable($name, $value.Trim(), "Process")
}
