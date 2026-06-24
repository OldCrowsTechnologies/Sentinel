#!/bin/bash
# Corvus Sentinel - one-time project setup
set -e
echo "Corvus Sentinel setup"
command -v node >/dev/null || { echo "Install Node 18+ first"; exit 1; }
echo "Node $(node -v)"

# Install JS deps and let Expo pin native module versions to the SDK
npm install
npx expo install --fix

# Verify the trained model is bundled
test -f assets/models/corvus-model.json && echo "Model present." || echo "WARNING: assets/models/corvus-model.json missing - run: python3 training/train_corvus.py"

[ -f .env ] || cp .env.example .env
echo "Setup complete. Next: 'npx expo-doctor' then 'eas build -p android --profile preview'"
