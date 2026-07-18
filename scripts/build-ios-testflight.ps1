# Corvus Sentinel - build iOS and push it to TestFlight via EAS (PowerShell).
# Your machine blocks .ps1 execution, so run this with an explicit bypass:
#     powershell -ExecutionPolicy Bypass -File .\scripts\build-ios-testflight.ps1
# It invokes eas through cmd /c so the eas.ps1 execution-policy block never applies.
#
# - build profile "demo-ios" bundles the C2 Supabase creds (extends production).
# - auto-submits with the "production" submit profile (ascAppId 6788990319).
# Builds from the local git HEAD (commit first). Submit is non-interactive via the
# account-level ASC API key. iOS build ~20-40 min, then Apple processes it before it
# shows in TestFlight.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
cmd /c "where eas >nul 2>nul || npm install -g eas-cli"
Write-Host "Building iOS (demo-ios) and auto-submitting to TestFlight (ascAppId 6788990319)..." -ForegroundColor Cyan
cmd /c "eas build --platform ios --profile demo-ios --auto-submit-with-profile production"
Write-Host "Done. Watch the EAS link above; the build then processes on Apple's side before appearing in TestFlight." -ForegroundColor Green
