#!/bin/bash
set -e
cd "$(dirname "$0")/.."
command -v eas >/dev/null || npm install -g eas-cli
eas whoami >/dev/null 2>&1 || eas login
eas init
eas build --platform android --profile preview
echo "Download the APK from the EAS link above and sideload it."
