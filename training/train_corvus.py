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
    base = parts[-1]
    lab_idx = {lab.lower(): i for i, lab in enumerate(LABELS)}

    # 1) exact folder == canonical label (e.g. "Potensic Atom 2")
    for parent in reversed(parts[:-1]):
        if parent in lab_idx:
            return lab_idx[parent]

    # 2) dataset filename codes, matched on the FILENAME ONLY and BEFORE the loose
    # keyword aliases -- so a containing folder (e.g. ".../dronenoise/...") can't
    # hijack them via a substring like "noise". Trailing "_" avoids the mic suffix.
    codes = {"_3p_": "DJI Mini 3 Pro", "_fp_": "DJI FPV", "_m3_": "DJI Mavic 3", "_yn_": "Yuneec"}
    for k, lab in codes.items():
        if k in base and lab.lower() in lab_idx:
            return lab_idx[lab.lower()]

    # 3) keyword alias -> canonical label name -> current index
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


def load_real_dataset(data_dir, win_sec=CLIP_SEC, holdout=None):
    """Walk data_dir, slice each file into win_sec windows, extract features.

    holdout: if set, files whose basename contains this substring are skipped
    (used to keep a clean held-out real-flyover set out of training).
    """
    paths = []
    for ext in ("wav", "WAV"):
        paths += glob.glob(os.path.join(data_dir, "**", f"*.{ext}"), recursive=True)
    paths = sorted(set(os.path.normcase(os.path.abspath(p)) for p in paths))  # dedupe case-insensitive FS
    waves, labels = [], []
    win = int(SR * win_sec)
    skipped = 0
    for p in paths:
        if holdout and holdout.lower() in os.path.basename(p).lower():
            continue
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


# Taxonomy grouping (by NAME so it's robust to index/label changes). See
# docs/TAXONOMY.md. NON-THREAT = called out but never alarmed on. CATEGORY = an
# acoustic drone TYPE (reported when no specific model matches). Everything else
# non-None/non-Unknown is a specific MODEL leaf (brand ID, best-effort by ear).
NON_THREAT_LABELS = {"None", "Bird", "Manned rotorcraft", "Manned fixed-wing"}
CATEGORY_LABELS = {"Small multirotor", "Medium multirotor", "Large multirotor",
                   "FPV racer", "Fixed-wing UAS", "Combustion UAS"}


def build_open_set(Xs, y, active_labels):
    """Per-class stats (STANDARDIZED space) + taxonomy grouping for the on-device
    open-set recognizer. `y` indexes `active_labels` (the classes actually
    present after remap), so classStats length == MLP output count == labels.

    Grouping the device uses:
      * nonThreatIndices  -> droneness = 1 - sum(P over these); these are CALLED
                             OUT positively (Bird / Helicopter / Jet / None),
                             never alarmed on. (Fixes the old 1 - P(None) that
                             would treat a jet as a drone.)
      * threatIndices     -> any UAS (categories + models + Unknown).
      * categoryIndices   -> acoustic TYPE fallback when no specific model matches.
      * specificDroneIndices -> specific MODEL leaves for brand matching / OOD.
    """
    stats = []
    for c, label in enumerate(active_labels):
        mask = y == c
        if not np.any(mask):
            stats.append({"label": label, "count": 0,
                          "centroid": [0.0] * FEATURE_DIM,
                          "variance": [1.0] * FEATURE_DIM})
            continue
        Xc = Xs[mask]
        centroid = Xc.mean(axis=0)
        # floor the variance so a near-constant feature can't dominate the metric
        variance = np.maximum(Xc.var(axis=0), 1e-2)
        stats.append({
            "label": label,
            "count": int(mask.sum()),
            "centroid": [float(v) for v in centroid],
            "variance": [float(v) for v in variance],
        })

    def idx(name):
        return active_labels.index(name) if name in active_labels else -1

    non_threat = [i for i, l in enumerate(active_labels) if l in NON_THREAT_LABELS]
    categories = [i for i, l in enumerate(active_labels) if l in CATEGORY_LABELS]
    threat = [i for i, l in enumerate(active_labels) if l not in NON_THREAT_LABELS]
    specific = [i for i, l in enumerate(active_labels)
                if l not in NON_THREAT_LABELS and l not in CATEGORY_LABELS and l != "Unknown"]

    return {
        "classStats": stats,
        "noneIndex": idx("None"),
        "unknownIndex": idx("Unknown"),
        "nonThreatIndices": non_threat,
        "threatIndices": threat,
        "categoryIndices": categories,
        "specificDroneIndices": specific,
        # Provisional thresholds (tune on real audio):
        #   droneGate   : droneness (1 - sum P[nonThreat]) above this => a UAS is present
        #   matchProb   : best specific-model prob below this => not a confident brand match
        #   oodDistance : nearest-known normalized distance above this => out-of-distribution
        "thresholds": {"droneGate": 0.5, "matchProb": 0.6, "oodDistance": 2.5},
    }


def export_model(clf, mean, scale, Xs, y, active_labels, path):
    """Serialize standardizer + MLP + DSP config + open-set stats to one JSON.

    `active_labels` are the classes actually present (post-remap), so the label
    list length matches the MLP's softmax output count. `y` indexes them."""
    if getattr(clf, "out_activation_", "softmax") != "softmax":
        raise SystemExit("Output layer is not softmax (only 2 classes present?) "
                         "-- add data / keep synthetic backfill for >= 3 classes.")
    layers = []
    n_layers = len(clf.coefs_)
    for i, (W, b) in enumerate(zip(clf.coefs_, clf.intercepts_)):
        layers.append({
            "W": [[float(v) for v in row] for row in W],   # shape (in, out)
            "b": [float(v) for v in b],
            "activation": "softmax" if i == n_layers - 1 else "relu",
        })

    model = {
        "version": 3,
        "format": "corvus-mlp-json",
        "labels": active_labels,
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
        "openSet": build_open_set(Xs, y, active_labels),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(model, f)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="*", default=[], help="folder(s) of labeled real WAVs")
    ap.add_argument("--per-class", type=int, default=400,
                    help="synthetic clips per class (0 = real only)")
    ap.add_argument("--holdout", default=None, help="skip real files whose name contains this substring (held-out eval)")
    ap.add_argument("--out", default=OUT_PATH, help="output model path")
    ap.add_argument("--seed", type=int, default=1337)
    args = ap.parse_args()

    waves, y = [], []

    if args.per_class > 0:
        print(f"Generating synthetic dataset ({args.per_class}/class)...")
        sw, sy = build_synthetic_dataset(per_class=args.per_class, seed=args.seed)
        waves += sw
        y = list(sy)

    for dd in args.data:
        print(f"Loading real dataset from {dd} ...")
        rw, ry = load_real_dataset(dd, holdout=args.holdout)
        waves += rw
        y = list(y) + list(ry)

    y = np.array(y)
    if len(waves) == 0:
        raise SystemExit("No data. Provide --data or set --per-class > 0.")

    # Remap to ONLY the classes actually present, preserving canonical LABELS
    # order. This keeps the MLP softmax output count == len(active_labels) ==
    # len(classStats); labels with no data (e.g. real-only leaves without
    # recordings) are simply omitted from this model instead of desyncing it.
    present = sorted(set(int(v) for v in y.tolist()))
    active_labels = [LABELS[i] for i in present]
    remap = {old: new for new, old in enumerate(present)}
    y = np.array([remap[int(v)] for v in y.tolist()])
    excluded = [LABELS[i] for i in range(len(LABELS)) if i not in present]
    print(f"Total clips: {len(waves)} | active classes ({len(active_labels)}): {active_labels}")
    if excluded:
        print(f"Excluded (no data): {excluded}")
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
    idxs = list(range(len(active_labels)))
    print(classification_report(yte, yp, labels=idxs, target_names=active_labels, zero_division=0))
    print("Confusion matrix (rows=true, cols=pred):")
    print("labels:", active_labels)
    print(confusion_matrix(yte, yp, labels=idxs))

    size = export_model(clf, mean, scale, Xs, y, active_labels, args.out)
    print(f"\nExported model -> {os.path.normpath(args.out)} ({size/1024:.1f} KB)")
    print("Feature dim:", FEATURE_DIM, "| Labels:", active_labels)


if __name__ == "__main__":
    main()
