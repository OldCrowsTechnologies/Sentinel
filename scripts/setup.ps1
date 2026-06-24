# Corvus Sentinel - setup (Windows)
$ErrorActionPreference = "Stop"
Write-Host "== Corvus Sentinel setup ==" -ForegroundColor Cyan
node -v | Out-Null
Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "Installing JS dependencies..." -ForegroundColor Cyan
npm install
Write-Host "Aligning native module versions to the Expo SDK..." -ForegroundColor Cyan
npx expo install --fix
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host "Created .env" }
Write-Host "Running expo-doctor..." -ForegroundColor Cyan
npx expo-doctor
Write-Host "Setup complete. Next: scripts\build-apk.ps1" -ForegroundColor Green
