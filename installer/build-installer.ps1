[CmdletBinding()]
param(
    [string]$InnoSetupPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Iss = Join-Path $PSScriptRoot "iii3xnz.iss"
$Output = Join-Path $Root "dist\installer"

if (-not $InnoSetupPath) {
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) {
        $InnoSetupPath = $command.Source
    } else {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
        )
        $InnoSetupPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
}

if (-not $InnoSetupPath -or -not (Test-Path $InnoSetupPath)) {
    throw "Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php, then run this script again."
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null
& $InnoSetupPath $Iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed with exit code $LASTEXITCODE."
}

$installer = Join-Path $Output "iii3xnz-Setup.exe"
if (-not (Test-Path $installer)) {
    throw "Inno Setup completed without producing $installer."
}
Write-Host "Built $installer"