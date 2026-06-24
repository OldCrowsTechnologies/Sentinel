# Corvus Sentinel - build Android APK via EAS (Windows)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Get-Command eas -ErrorAction SilentlyContinue)) {
  Write-Host "Installing eas-cli globally..." -ForegroundColor Cyan
  npm install -g eas-cli
}
Write-Host "Logging in to Expo (oldcrowswireless)..." -ForegroundColor Cyan
eas whoami 2>$null; if ($LASTEXITCODE -ne 0) { eas login }
Write-Host "Linking to project oldcrowswireless/corvus-sentinel..." -ForegroundColor Cyan
eas init
Write-Host "Building preview APK (cloud)..." -ForegroundColor Cyan
eas build --platform android --profile preview
Write-Host "Done. Download the APK from the EAS link above and sideload it." -ForegroundColor Green
