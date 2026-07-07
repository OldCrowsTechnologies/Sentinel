"""
augment.py
==========
Data multiplier for Corvus Sentinel: turn a SMALL set of clean drone clips into
a LARGE labeled training set by mixing them with a big bank of (license-safe)
noise at many SNRs, gains, throttle variations, and time offsets.

Why this exists
---------------
The bottleneck is DRONE audio (hard to record), not noise (abundant + safe to
source: your own recordings, CC0 Freesound). Standard small-data practice:
multiply each scarce positive by combining it with many negatives under many
conditions. A dozen real Skydio X2 clips -> hundreds of realistic variants the
model can learn a robust rotor signature from.

100% license-safe: it only combines audio YOU provide (your captures + CC0/owned
noise). It creates no new IP exposure.

What it does per source drone clip
----------------------------------
For each output variant, randomly:
  * pick a noise clip from --noise, mix at a random SNR (default -5..20 dB)
  * apply a random overall gain (mic distance/level)
  * apply a small time shift / crop offset
  * apply a small speed change (+/-3%) to emulate throttle/RPM drift
    -- kept TINY on purpose: a large shift would move a rotor's blade-pass
       fundamental into another platform's band and MISLABEL the class.
Output: CLIP_SEC 16 kHz mono WAV, named "<ClassKeyword>__<srcID>__v###.wav" so
train_corvus.py auto-labels by folder AND you can split train/test by <srcID>
(the source clip) to avoid session-level leakage.

Usage
-----
  # multiply drone clips in data/seed/<Class>/ using a noise bank, 60x each:
  python training/augment.py --drones data/seed --noise data/noise \\
      --out data/recordings --per-source 60

  # noise-only expansion for the None class (augment negatives too):
  python training/augment.py --noise data/noise --out data/recordings \\
      --none-variants 500
"""

import argparse
import glob
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

from corvus_features import SR, LABELS
from corvus_synth import CLIP_SEC

N = int(SR * CLIP_SEC)
AUDIO_GLOBS = ("*.wav", "*.WAV")

# Folder name -> class keyword that train_corvus._label_from_path resolves.
# We just reuse the canonical label as the filename prefix (spaces -> _).
def _prefix_for(label):
    return label.replace(" ", "_")


def _read_wav_mono_16k(path):
    sr, data = wavfile.read(path)
    data = data.astype(np.float64)
    if data.ndim > 1:
        data = data.mean(axis=1)
    peak = np.max(np.abs(data)) + 1e-9
    if np.issubdtype(np.dtype(data.dtype), np.integer) or peak > 1.5:
        data = data / peak
    if sr != SR:
        from math import gcd
        g = gcd(int(sr), SR)
        data = resample_poly(data, SR // g, int(sr) // g)
    return data


def _write_wav(path, x):
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype(np.int16)
    wavfile.write(path, SR, pcm)


def _fit_len(x, rng, allow_shift=True):
    """Return exactly N samples: random crop if long, tile+pad if short."""
    if len(x) == 0:
        return np.zeros(N)
    if len(x) >= N:
        start = rng.integers(0, len(x) - N + 1) if allow_shift else 0
        return x[start:start + N].copy()
    reps = int(np.ceil(N / len(x)))
    tiled = np.tile(x, reps)[:N]
    return tiled


def _speed_perturb(x, rng, max_pct=0.03):
    """Tiny resample to emulate throttle/RPM drift. Kept small so a rotor's
    fundamental never crosses into another platform's band."""
    factor = 1.0 + rng.uniform(-max_pct, max_pct)
    n_out = max(2, int(round(len(x) / factor)))
    xp = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
    xq = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(xq, xp, x)


def _mix_at_snr(sig, noise, snr_db):
    sp = np.mean(sig ** 2) + 1e-12
    npow = np.mean(noise ** 2) + 1e-12
    k = np.sqrt(sp / (npow * (10 ** (snr_db / 10.0))))
    return sig + k * noise


def _load_bank(paths):
    bank = []
    for p in paths:
        try:
            bank.append(_read_wav_mono_16k(p))
        except Exception as e:
            print(f"  ! skip noise {p}: {e}")
    return bank


def _collect(root):
    files = []
    if root and os.path.isdir(root):
        for g in AUDIO_GLOBS:
            files += glob.glob(os.path.join(root, "**", g), recursive=True)
    return sorted(set(os.path.normcase(os.path.abspath(p)) for p in files))


def _class_of(path, root):
    """Class = immediate subfolder under root (must match a LABELS entry, or a
    keyword the trainer resolves). Falls back to 'Unknown'."""
    rel = os.path.relpath(path, root)
    top = rel.replace("\\", "/").split("/")[0]
    for lab in LABELS:
        if top.lower() == lab.lower():
            return lab
    return top  # let the trainer's keyword resolver handle it downstream


def augment_drones(drones_root, noise_bank, out_root, per_source, snr_lo, snr_hi,
                   gain_lo, gain_hi, seed):
    rng = np.random.default_rng(seed)
    srcs = _collect(drones_root)
    if not srcs:
        print(f"  (no drone source clips found under {drones_root})")
        return 0
    if not noise_bank:
        print("  ! no noise bank loaded -- drone augmentation needs --noise")
        return 0
    written = 0
    for si, src in enumerate(srcs):
        label = _class_of(src, drones_root)
        try:
            base = _read_wav_mono_16k(src)
        except Exception as e:
            print(f"  ! skip drone {src}: {e}")
            continue
        out_dir = os.path.join(out_root, label)
        os.makedirs(out_dir, exist_ok=True)
        src_id = f"s{si:03d}"
        prefix = _prefix_for(label)
        for v in range(per_source):
            sig = _fit_len(base, rng, allow_shift=True)
            if rng.random() < 0.8:
                sig = _fit_len(_speed_perturb(sig, rng), rng, allow_shift=False)
            noise = _fit_len(noise_bank[rng.integers(len(noise_bank))], rng)
            snr = rng.uniform(snr_lo, snr_hi)
            mixed = _mix_at_snr(sig, noise, snr)
            mixed = mixed / (np.max(np.abs(mixed)) + 1e-9)
            mixed = mixed * rng.uniform(gain_lo, gain_hi)
            fn = f"{prefix}__{src_id}__v{v:03d}.wav"
            _write_wav(os.path.join(out_dir, fn), mixed)
            written += 1
    print(f"  drone augmentation: {written} clips from {len(srcs)} sources")
    return written


def augment_none(noise_bank, noise_paths, out_root, n_variants, gain_lo, gain_hi, seed):
    """Expand the None class straight from the noise bank (optionally layering
    two noises for density)."""
    rng = np.random.default_rng(seed + 1)
    if not noise_bank:
        print("  (no noise bank -- skipping None expansion)")
        return 0
    out_dir = os.path.join(out_root, "None")
    os.makedirs(out_dir, exist_ok=True)
    written = 0
    for v in range(n_variants):
        i = rng.integers(len(noise_bank))
        sig = _fit_len(noise_bank[i], rng)
        if rng.random() < 0.4:  # layer a second noise for busier ambiences
            j = rng.integers(len(noise_bank))
            sig = sig + 0.7 * _fit_len(noise_bank[j], rng)
        sig = sig / (np.max(np.abs(sig)) + 1e-9)
        sig = sig * rng.uniform(gain_lo, gain_hi)
        src_id = f"n{i:03d}"
        _write_wav(os.path.join(out_dir, f"None__{src_id}__v{v:03d}.wav"), sig)
        written += 1
    print(f"  None expansion: {written} clips")
    return written


def main():
    ap = argparse.ArgumentParser(description="Multiply scarce drone audio via safe mixing.")
    ap.add_argument("--drones", default=None, help="root with <Class>/ subfolders of source drone WAVs")
    ap.add_argument("--noise", default=None, help="root of noise WAVs (your own / CC0)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "recordings"),
                    help="output root (train_corvus reads this)")
    ap.add_argument("--per-source", type=int, default=60, help="variants per drone source clip")
    ap.add_argument("--none-variants", type=int, default=0, help="also emit this many None clips from the noise bank")
    ap.add_argument("--snr-lo", type=float, default=-5.0)
    ap.add_argument("--snr-hi", type=float, default=20.0)
    ap.add_argument("--gain-lo", type=float, default=0.2)
    ap.add_argument("--gain-hi", type=float, default=0.95)
    ap.add_argument("--seed", type=int, default=1337)
    args = ap.parse_args()

    out_root = os.path.abspath(args.out)
    os.makedirs(out_root, exist_ok=True)
    print(f"Augment -> {out_root}")

    noise_paths = _collect(args.noise) if args.noise else []
    noise_bank = _load_bank(noise_paths)
    print(f"  noise bank: {len(noise_bank)} clips")

    total = 0
    if args.drones:
        total += augment_drones(args.drones, noise_bank, out_root, args.per_source,
                                args.snr_lo, args.snr_hi, args.gain_lo, args.gain_hi, args.seed)
    if args.none_variants > 0:
        total += augment_none(noise_bank, noise_paths, out_root, args.none_variants,
                              args.gain_lo, args.gain_hi, args.seed)

    print(f"Done. {total} augmented clips written under {out_root}/<Class>/.")
    print("Then retrain: powershell -ExecutionPolicy Bypass -File scripts\\retrain.ps1")


if __name__ == "__main__":
    main()
