@echo off
REM Corvus Sentinel - build iOS and push it to TestFlight via EAS.
REM Batch file so it runs regardless of PowerShell's script-execution policy.
REM - build profile "demo-ios" bundles the C2 Supabase creds (extends production).
REM - auto-submits with the "production" submit profile (ascAppId 6788990319).
REM Builds from the local git HEAD; commit first. Submit is non-interactive via the
REM account-level ASC API key. iOS build ~20-40 min, then Apple processes it before
REM it appears in TestFlight.
cd /d "%~dp0.."
where eas >nul 2>nul || npm install -g eas-cli
eas build --platform ios --profile demo-ios --auto-submit-with-profile production
