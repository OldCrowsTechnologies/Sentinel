#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "== Corvus Sentinel setup =="
command -v node >/dev/null || { echo "Install Node 18+"; exit 1; }
npm install
npx expo install --fix
[ -f .env ] || cp .env.example .env
npx expo-doctor || true
echo "Setup complete. Next: bash scripts/build-apk.sh"
