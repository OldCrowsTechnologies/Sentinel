"""
train_corvus.py
===============
Train the Corvus Sentinel acoustic classifier and export it in the
self-contained JSON format the Expo app loads (no TFLite / no tfjs runtime
required -- the on-device forward pass is plain TypeScript in lib/mlClassifier.ts).

USAGE
-----
  # Bootstrap on synthetic signatures (no data needed):
  python3 train_corvus.py

  # Production: train on real recordings. Point --data at a folder whose
  # subfolders are class names, e.g.
  #   data/train/None/*.wav
  #   data/train/Skydio X2/*.wav
  #   data/train/DJI Phantom/*.wav
  # (or .wav files whose names contain a class keyword like "skydio")
  python3 train_corvus.py --data /path/to/recordings --per-class 0

  # Mix synthetic + real (recommended while you collect Skydio captures):
  python3 train_corvus.py --data /path/to/recordings --per-class 300

Output: ../assets/models/corvus-model.json
"""

import argparse
import glob
import json
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import classification_report, confusion_matrix

from corvus_features import (
    SR, NFFT, HOP, N_MELS, MEL_FB, BAND_RATIOS, FEATURE_DIM, LABELS,
    HIGH_PASS_ENABLED, HIGH_PASS_FC,
    STATIONARITY_ENABLED, STATIONARITY_EPS, STATIONARITY_MIN_FRAMES, STATIONARITY_FLOOR,
    extract_features,
)
from corvus_synth import build_synthetic_dataset, CLIP_SEC

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "..", "assets", "models", "corvus-model.json")


# ---------------------------------------------------------------------------
# Real-data loading
# ---------------------------------------------------------------------------
def _label_from_path(path):
    """Infer class index from parent folder name or filename keyword.

    Indices are derived from LABELS (never hardcoded) so adding/reordering a
    class can't silently mislabel a folder. We first try an exact match of a
    parent folder against the canonical label set, then fall back to keyword
    aliases that map to a canonical label NAME (resolved to its current index).
    """
    parts = [p.lower() for p in path.replace("\\", "/").split("/")]
    hay = " ".join(parts[-2:])
    lab_idx = {lab.lower(): i for i, lab in enumerate(LABELS)}

    # 1) exact folder == canonical label (e.g. "Potensic Atom 2")
    for parent in reversed(parts[:-1]):
        if parent in lab_idx:
            return lab_idx[parent]

    # 2) keyword alias -> canonical label name -> current index
    alias = {
        "none": "None", "noise": "None", "background": "None", "negative": "None", "ambient": "None",
        "skydio": "Skydio X2", "x2": "Skydio X2",
        "dji": "DJI Phantom", "phantom": "DJI Phantom", "mavic": "DJI Phantom",
        "parrot": "Parrot Anafi", "anafi": "Parrot Anafi",
        "potensic": "Potensic Atom 2", "atom": "Potensic Atom 2",
        "unknown": "Unknown", "other": "Unknown",
    }
    def _resolve(text):
        for k, lab in alias.items():
            if k in text and lab.lower() in lab_idx:
                return lab_idx[lab.lower()]
        return None
    for parent in reversed(parts[:-1]):
        r = _resolve(parent)
        if r is not None:
            return r
    return _resolve(hay)


def _load_wav_mono_16k(path):
    sr, data = wavfile.read(path)
    data = data.astype(np.float64)
    if data.ndim > 1:
        data = data.mean(axis=1)
    # Normalize integer PCM to [-1, 1]
    if np.issubdtype(np.dtype(data.dtype), np.integer) or np.max(np.abs(data)) > 1.5:
        data = data / (np.max(np.abs(data)) + 1e-9)
    if sr != SR:
        # rational resample to 16 kHz
        from math import gcd
        g = gcd(int(sr), SR)
        data = resample_poly(data, SR // g, int(sr) // g)
    return data


def load_real_dataset(data_dir, win_sec=CLIP_SEC):
    """Walk data_dir, slice each file into win_sec windows, extract features."""
    paths = []
    for ext in ("wav", "WAV"):
        paths += glob.glob(os.path.join(data_dir, "**", f"*.{ext}"), recursive=True)
    paths = sorted(set(os.path.normcase(os.path.abspath(p)) for p in paths))  # dedupe case-insensitive FS
    waves, labels = [], []
    win = int(SR * win_sec)
    skipped = 0
    for p in paths:
        li = _label_from_path(p)
        if li is None:
            skipped += 1
            continue
        try:
            x = _load_wav_mono_16k(p)
        except Exception as e:
            print(f"  ! skip {p}: {e}")
            skipped += 1
            continue
        if len(x) < win:
            waves.append(np.pad(x, (0, win - len(x))))
            labels.append(li)
        else:
            for start in range(0, len(x) - win + 1, win):
                waves.append(x[start:start + win])
                labels.append(li)
    print(f"  loaded {len(waves)} windows from {len(paths)} files ({skipped} skipped)")
    return waves, np.array(labels)


# ---------------------------------------------------------------------------
# Train + export
# ---------------------------------------------------------------------------
def featurize(waves):
    X = np.zeros((len(waves), FEATURE_DIM), dtype=np.float64)
    for i, w in enumerate(waves):
        X[i] = extract_features(w)
    return X


def build_open_set(Xs, y):
    """Per-class statistics in STANDARDIZED feature space, used on-device for
    open-set recognition: deciding a contact is a drone but NOT in our library
    (-> "possible homemade / unknown build"). For each class we export the
    centroid + diagonal variance; the device computes a variance-normalized
    distance to each known *specific* drone class and flags novelty when the
    nearest known class is too far (or the match probability too low).
    """
    stats = []
    for c in range(len(LABELS)):
        mask = y == c
        if not np.any(mask):
            stats.append({"label": LABELS[c], "count": 0,
                          "centroid": [0.0] * FEATURE_DIM,
                          "variance": [1.0] * FEATURE_DIM})
            continue
        Xc = Xs[mask]
        centroid = Xc.mean(axis=0)
        # floor the variance so a near-constant feature can't dominate the metric
        variance = np.maximum(Xc.var(axis=0), 1e-2)
        stats.append({
            "label": LABELS[c],
            "count": int(mask.sum()),
            "centroid": [float(v) for v in centroid],
            "variance": [float(v) for v in variance],
        })

    none_idx = LABELS.index("None") if "None" in LABELS else -1
    unknown_idx = LABELS.index("Unknown") if "Unknown" in LABELS else -1
    specific = [i for i in range(len(LABELS)) if i not in (none_idx, unknown_idx)]

    return {
        "classStats": stats,
        "noneIndex": none_idx,
        "unknownIndex": unknown_idx,
        "specificDroneIndices": specific,
        # Provisional thresholds (tune on real audio):
        #   droneGate     : 1 - P(None) above this => a drone is present
        #   matchProb     : best specific-class prob below this => not a confident match
        #   oodDistance   : nearest-known normalized distance above this => out-of-distribution
        "thresholds": {"droneGate": 0.5, "matchProb": 0.6, "oodDistance": 2.5},
    }


def export_model(clf, mean, scale, Xs, y, path):
    """Serialize standardizer + MLP + DSP config + open-set stats to one JSON."""
    layers = []
    n_layers = len(clf.coefs_)
    for i, (W, b) in enumerate(zip(clf.coefs_, clf.intercepts_)):
        layers.append({
            "W": [[float(v) for v in row] for row in W],   # shape (in, out)
            "b": [float(v) for v in b],
            "activation": "softmax" if i == n_layers - 1 else "relu",
        })

    model = {
        "version": 2,
        "format": "corvus-mlp-json",
        "labels": LABELS,
        "dsp": {
            "sampleRate": SR,
            "nfft": NFFT,
            "hop": HOP,
            "nMels": N_MELS,
            "clipSec": CLIP_SEC,
            "bandRatios": [[lo, hi] for (lo, hi) in BAND_RATIOS],
            "melFilterbank": [[float(v) for v in row] for row in MEL_FB],  # (N_MELS, nbins)
            "highPass": {"enabled": bool(HIGH_PASS_ENABLED), "fc": float(HIGH_PASS_FC), "order": 1},
            "stationarity": {"enabled": bool(STATIONARITY_ENABLED), "eps": float(STATIONARITY_EPS), "minFrames": int(STATIONARITY_MIN_FRAMES), "floor": float(STATIONARITY_FLOOR)},
        },
        "featureDim": FEATURE_DIM,
        "scaler": {"mean": [float(v) for v in mean], "scale": [float(v) for v in scale]},
        "mlp": {"layers": layers},
        "openSet": build_open_set(Xs, y),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(model, f)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None, help="folder of labeled real WAVs")
    ap.add_argument("--per-class", type=int, default=400,
                    help="synthetic clips per class (0 = real only)")
    ap.add_argument("--seed", type=int, default=1337)
    args = ap.parse_args()

    waves, y = [], []

    if args.per_class > 0:
        print(f"Generating synthetic dataset ({args.per_class}/class)...")
        sw, sy = build_synthetic_dataset(per_class=args.per_class, seed=args.seed)
        waves += sw
        y = list(sy)

    if args.data:
        print(f"Loading real dataset from {args.data} ...")
        rw, ry = load_real_dataset(args.data)
        waves += rw
        y = list(y) + list(ry)

    y = np.array(y)
    if len(waves) == 0:
        raise SystemExit("No data. Provide --data or set --per-class > 0.")

    print(f"Total clips: {len(waves)} | classes present: {sorted(set(y.tolist()))}")
    print("Extracting features...")
    X = featurize(waves)

    # Standardize
    mean = X.mean(axis=0)
    scale = X.std(axis=0) + 1e-8
    Xs = (X - mean) / scale

    Xtr, Xte, ytr, yte = train_test_split(
        Xs, y, test_size=0.2, random_state=args.seed, stratify=y
    )

    print("Training MLP (64, 32)...")
    clf = MLPClassifier(
        hidden_layer_sizes=(64, 32),
        activation="relu",
        alpha=1e-3,
        max_iter=400,
        random_state=args.seed,
    )
    clf.fit(Xtr, ytr)

    acc = clf.score(Xte, yte)
    print(f"\n=== Held-out accuracy: {acc*100:.1f}% ===\n")
    yp = clf.predict(Xte)
    present = sorted(set(y.tolist()))
    names = [LABELS[i] for i in present]
    print(classification_report(yte, yp, labels=present, target_names=names, zero_division=0))
    print("Confusion matrix (rows=true, cols=pred):")
    print("labels:", names)
    print(confusion_matrix(yte, yp, labels=present))

    size = export_model(clf, mean, scale, Xs, y, OUT_PATH)
    print(f"\nExported model -> {os.path.normpath(OUT_PATH)} ({size/1024:.1f} KB)")
    print("Feature dim:", FEATURE_DIM, "| Labels:", LABELS)


if __name__ == "__main__":
    main()
