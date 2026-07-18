# Corvus Sentinel - build the DEMO Android APK via EAS (Windows)
# Uses the "demo" profile, which bundles the C2 Supabase creds (unlike "preview").
# Builds from the local git HEAD -- commit your changes first.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Get-Command eas -ErrorAction SilentlyContinue)) {
  Write-Host "Installing eas-cli globally..." -ForegroundColor Cyan
  npm install -g eas-cli
}
Write-Host "Checking Expo login (oldcrowswireless)..." -ForegroundColor Cyan
eas whoami 2>$null; if ($LASTEXITCODE -ne 0) { eas login }
Write-Host "Building DEMO APK (cloud, profile=demo)..." -ForegroundColor Cyan
eas build --platform android --profile demo
Write-Host "Done. Download the APK from the EAS link above and sideload it." -ForegroundColor Green
