# Data credits & licenses

Corvus Sentinel's acoustic model is trained on a mix of synthetic signatures,
first-party field captures, and third-party open datasets. Raw third-party
datasets are **not** redistributed in this repo — they are downloaded separately
at train time.

## DroneNoise Database (University of Salford) — CC BY 4.0
Ramos-Romero, C.; Green, N.; Asensio, C.; Torija Martínez, A. J. — *DroneNoise
Database*, University of Salford.
https://salford.figshare.com/articles/dataset/DroneNoise_Database/22133411 —
licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/).

Real sUAS overflight recordings (calibrated, multi-microphone, Edzell, Scotland,
2022) used to train the **DJI Mini 3 Pro, DJI FPV, DJI Mavic 3, and Yuneec**
classes. Held-out validation (event 3, excluded from training) gave 100%
detection on all four. Attribution provided per the license.

## First-party field captures
- **Potensic Atom 2** — field capture (kpitts, 2026-06-29)
- **DJI Mini 5 Pro** — Reddit crowd-source push, 2026 (`data/recordings/DJI Mini 5 Pro/`)
- **Negatives (None)** — crowd/voice/bar/business venue recordings

## Synthetic signatures
`training/corvus_synth.py` — physically-grounded bootstrap profiles for classes
without (or pending) real audio. Validation showed synthetic-only training does
not generalize to real drones; real captures are the priority.
