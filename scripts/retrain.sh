#!/bin/bash
set -e
cd "$(dirname "$0")/.."
python3 training/train_corvus.py --data data/recordings --per-class 300
bash training/run_parity.sh
echo "Retrained + parity-checked. Rebuild: bash scripts/build-apk.sh"
