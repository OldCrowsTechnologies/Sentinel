# Real recordings -> production model

Drop **16 kHz mono WAV** files into the class folder that matches the source:

```
data/recordings/
├── None/           # ambient, wind, traffic, voices, HVAC -- anything that ISN'T a drone
├── Skydio X2/      # your own Skydio X2 captures (most important)
├── DJI Phantom/    # DJI Phantom / Mavic
├── Parrot Anafi/   # Parrot Anafi
└── Unknown/        # other drones you want flagged but not identified
```

Filenames are also auto-labeled if they contain a keyword (skydio, dji, phantom,
mavic, parrot, anafi, none/noise/background). So DADS / DroneAudioSet files work
as-is if you sort them into these folders.

Recording tips (per corvus-sentinel-project.md):
- Hover at 5 / 10 / 20 ft; forward flight at 50% and 100% throttle.
- Capture 5+ minutes of clean "None" baseline in the deployment environment.
- Any sample rate works (auto-resampled to 16 kHz); mono preferred.

Then retrain:

```
# Windows
powershell -ExecutionPolicy Bypass -File scripts\retrain.ps1
# macOS/Linux
bash scripts/retrain.sh
```

This overwrites assets/models/corvus-model.json and re-checks train/inference
parity. Rebuild the APK afterward to ship the new brain.
