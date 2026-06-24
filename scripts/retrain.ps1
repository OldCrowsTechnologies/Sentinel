# Corvus Sentinel - retrain the brain on real recordings (Windows)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "Training on data\recordings (+ synthetic backstop)..." -ForegroundColor Cyan
python training\train_corvus.py --data data\recordings --per-class 300
Write-Host "Model written to assets\models\corvus-model.json" -ForegroundColor Green
Write-Host "Verify parity if you have bash/node available: npm run parity" -ForegroundColor Yellow
Write-Host "Then rebuild: scripts\build-apk.ps1" -ForegroundColor Yellow
