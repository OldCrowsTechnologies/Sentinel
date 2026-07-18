@echo off
REM Corvus Sentinel - build the DEMO Android APK via EAS (Windows, cmd.exe).
REM Batch file so it runs regardless of PowerShell's script-execution policy.
REM Uses the "demo" profile (bundles the C2 Supabase creds). Builds from git HEAD.
cd /d "%~dp0.."
where eas >nul 2>nul || npm install -g eas-cli
eas build --platform android --profile demo
