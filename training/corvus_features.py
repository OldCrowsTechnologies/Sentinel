"""
corvus_features.py
==================
Acoustic feature extraction for Corvus Sentinel.

THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR FEATURES.
The on-device TypeScript implementation in `lib/dsp.ts` mirrors this math
exactly. Any change here MUST be reflected there, or the model will not
fire on real audio (train/inference parity).

Design choices that make parity easy:
  * No librosa. Everything is plain numpy (rfft, matmul, log).
  * The mel filterbank matrix is EXPORTED inside the model JSON, so the
    device side never recomputes mel point math -- it just does a matmul.
  * Features are log-mel band energies (mean + std across frames) plus a
    few drone-band energy ratios. This is exactly the representation that
    acoustic drone detectors key on (the harmonic comb of the rotors).

Feature vector layout (length = 2*N_MELS + N_BAND_RATIOS):
  [ mel_mean[0..N_MELS-1],
    mel_std[0..N_MELS-1],
    band_ratio[0..N_BAND_RATIOS-1] ]
"""

import os
import numpy as np

# ---------------------------------------------------------------------------
# Constants -- MUST match lib/dsp.ts
# ---------------------------------------------------------------------------
SR = 16000          # sample rate (Hz)
NFFT = 512          # FFT size (power of two for radix-2 FFT on device)
HOP = 256           # hop length (samples)
N_MELS = 20         # number of mel bands
FMIN = 50.0         # lowest mel edge (Hz)
FMAX = 8000.0       # highest mel edge (Hz) == Nyquist for SR=16000

# Noise rejection: a 1st-order IIR high-pass applied (after DC removal, before
# framing). The corner frequency is EXPORTED in the model JSON (dsp.highPass.fc)
# and lib/dsp.ts reads it from there, so this value can be retuned in Python
# alone and parity still holds after a retrain (the recurrence is identical on
# both sides -- run_parity.sh).
#
# TAXONOMY CHANGE (2026-07-07): lowered 400 -> 40 Hz. The old 400 Hz corner was
# tuned to kill voice fundamentals (~85-255 Hz), but it also ERASED the defining
# low-frequency signatures of the new classes -- combustion/one-way-attack UAS
# (engine firing ~40-130 Hz), manned rotorcraft, and prop/turbine aircraft all
# live mostly below 400 Hz. Voice rejection now leans on the STATIONARITY GATE
# (voice is bursty/non-stationary -> suppressed; engine & rotor combs are steady
# -> kept) plus the runtime VAD + confidence gating. TRADE-OFF: more low-band
# energy reaches the model, so voice-rejection must be re-validated in the field
# (Analysis screen: record voices, confirm drone score stays ~0). Revert = set
# this back to 400.0 and retrain.
HIGH_PASS_ENABLED = True
HIGH_PASS_FC = 40.0  # Hz  (was 400.0 -- see note above)

# Stationarity gate: a per-frequency-bin gain = median/mean of that bin's power
# across the window's frames. A drone's blade-pass comb is STATIONARY (present in
# ~every frame) so median~mean -> gain~1 (kept); voice/crowd is NON-STATIONARY
# (bursty) so median<<mean -> gain<1 (suppressed). This raises drone SNR in
# crowds. FEATURE-PATH change -> lib/dsp.ts mirrors it and it's trained-in; keep
# in lockstep (run_parity.sh). gain is clamped to <=1 (never amplifies).
STATIONARITY_ENABLED = os.environ.get("CORVUS_STATIONARITY", "1") != "0"  # A/B via env
STATIONARITY_EPS = 1e-10
STATIONARITY_MIN_FRAMES = 4  # need a few frames for a meaningful median
# Suppression floor: gain is clamped to [FLOOR, 1]. 0 = full suppression (also
# erodes drones' own harmonic wander); ~0.5 keeps drone structure while still
# knocking down bursty crowd/voice. Sweep-tuned; env override for experiments.
STATIONARITY_FLOOR = float(os.environ.get("CORVUS_STAT_FLOOR", "0.5"))

# Band energy ratios (Hz ranges) -- documented blade-pass / engine regions.
# These give the classifier explicit, interpretable handles on each platform.
# Two bands added for the full taxonomy: a low band for combustion/engine +
# manned-rotor fundamentals (needs the 40 Hz high-pass above to survive), and a
# high band for FPV/small-multirotor fast blade-pass. Adding ratios is parity-
# safe: dsp.ts iterates cfg.bandRatios from the JSON, so both sides stay in sync.
BAND_RATIOS = [
    (40.0, 200.0),      # NEW: combustion/engine firing + manned-rotor low end
    (700.0, 1500.0),    # Skydio X2 / medium-multirotor fundamental (~800-1400)
    (1100.0, 1900.0),   # DJI Phantom region (~1200-1800)
    (850.0, 1300.0),    # Parrot Anafi region (~920-1200)
    (1800.0, 3500.0),   # NEW: FPV / small-multirotor fast blade-pass
    (50.0, 700.0),      # broadband low rumble beneath tonal comb
]
N_BAND_RATIOS = len(BAND_RATIOS)

FEATURE_DIM = 2 * N_MELS + N_BAND_RATIOS

# Class labels (index order is the model output order).
#
# Full airspace taxonomy (2026-07-07). A single flat softmax over acoustically-
# separable classes: the app calls out the most specific class the SOUND supports.
# Brand-level ID among same-size electric multirotors isn't reliable by mic --
# that comes from Remote ID -- so those are covered by size CATEGORIES here, with
# a few flagship models kept as their own classes. Grouping (see docs/TAXONOMY.md
# + train_corvus.build_open_set):
#   NON-THREAT (called out, never alarmed): None, Bird, Manned rotorcraft, Manned fixed-wing
#   UAS CATEGORIES (the "every type" coverage): Small/Medium/Large multirotor,
#                    FPV racer, Fixed-wing UAS, Combustion UAS
#   SPECIFIC MODELS (acoustic best-effort; RID authoritative): Skydio X2, DJI
#                    Phantom, Parrot Anafi, Potensic Atom 2, DJI Mini 3/5 Pro,
#                    DJI FPV, DJI Mavic 3, Yuneec
#   OPEN-SET CATCH-ALL: Unknown
LABELS = [
    # Non-threat
    "None", "Bird", "Manned rotorcraft", "Manned fixed-wing",
    # UAS acoustic categories
    "Small multirotor", "Medium multirotor", "Large multirotor",
    "FPV racer", "Fixed-wing UAS", "Combustion UAS",
    # Specific models
    "Skydio X2", "DJI Phantom", "Parrot Anafi", "Potensic Atom 2",
    "DJI Mini 3 Pro", "DJI Mini 5 Pro", "DJI FPV", "DJI Mavic 3", "Yuneec",
    # Open-set catch-all
    "Unknown",
]


# ---------------------------------------------------------------------------
# Mel filterbank
# ---------------------------------------------------------------------------
def hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + f / 700.0)


def mel_to_hz(m):
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)


def build_mel_filterbank():
    """Triangular mel filterbank, shape (N_MELS, NFFT//2 + 1)."""
    n_bins = NFFT // 2 + 1
    fft_freqs = np.linspace(0.0, SR / 2.0, n_bins)

    mel_min = hz_to_mel(FMIN)
    mel_max = hz_to_mel(FMAX)
    mel_points = np.linspace(mel_min, mel_max, N_MELS + 2)
    hz_points = mel_to_hz(mel_points)

    fb = np.zeros((N_MELS, n_bins), dtype=np.float64)
    for m in range(1, N_MELS + 1):
        f_left = hz_points[m - 1]
        f_center = hz_points[m]
        f_right = hz_points[m + 1]
        for k in range(n_bins):
            f = fft_freqs[k]
            if f_left <= f <= f_center and f_center > f_left:
                fb[m - 1, k] = (f - f_left) / (f_center - f_left)
            elif f_center < f <= f_right and f_right > f_center:
                fb[m - 1, k] = (f_right - f) / (f_right - f_center)
    return fb


MEL_FB = build_mel_filterbank()
HANN = np.hanning(NFFT).astype(np.float64)


def high_pass(x, fc=HIGH_PASS_FC, fs=SR):
    """1st-order IIR high-pass. EXPLICIT recurrence (matches lib/dsp.ts exactly):
        y[0] = x[0]; y[n] = alpha * (y[n-1] + x[n] - x[n-1])
    where alpha = RC / (RC + dt), RC = 1/(2*pi*fc), dt = 1/fs.
    """
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if n == 0:
        return x
    rc = 1.0 / (2.0 * np.pi * fc)
    dt = 1.0 / fs
    alpha = rc / (rc + dt)
    y = np.empty(n, dtype=np.float64)
    y[0] = x[0]
    prev_x = x[0]
    prev_y = x[0]
    for i in range(1, n):
        xi = x[i]
        yi = alpha * (prev_y + xi - prev_x)
        y[i] = yi
        prev_x = xi
        prev_y = yi
    return y


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------
def _frame_signal(x):
    """Split signal into overlapping NFFT frames (last partial frame dropped)."""
    if len(x) < NFFT:
        x = np.pad(x, (0, NFFT - len(x)))
    n_frames = 1 + (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    return x[idx]


def extract_features(x, sr=SR):
    """Extract the Corvus feature vector from a mono waveform.

    Parameters
    ----------
    x : 1-D float array, samples in roughly [-1, 1]
    sr : sample rate (must be SR; caller is responsible for resampling)

    Returns
    -------
    1-D float array of length FEATURE_DIM
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)  # downmix to mono
    # Remove DC offset
    x = x - np.mean(x)
    # Noise-rejection high-pass (must mirror lib/dsp.ts exactly for parity)
    if HIGH_PASS_ENABLED:
        x = high_pass(x, HIGH_PASS_FC, SR)

    frames = _frame_signal(x)                 # (n_frames, NFFT)
    windowed = frames * HANN[None, :]
    spec = np.fft.rfft(windowed, n=NFFT, axis=1)
    power = (np.abs(spec) ** 2)               # (n_frames, n_bins)

    # Stationarity gate (mirror of lib/dsp.ts): suppress non-stationary
    # (voice/crowd) energy, keep steady drone tones. Applied to power before mel
    # + band ratios so both feature families see the cleaned spectrum.
    if STATIONARITY_ENABLED and power.shape[0] >= STATIONARITY_MIN_FRAMES:
        med = np.median(power, axis=0)        # per-bin temporal median
        mn = power.mean(axis=0)               # per-bin temporal mean
        gain = np.maximum(STATIONARITY_FLOOR, np.minimum(1.0, med / (mn + STATIONARITY_EPS)))
        power = power * gain[None, :]

    # Mel energies (log)
    mel_energy = power @ MEL_FB.T             # (n_frames, N_MELS)
    log_mel = np.log(mel_energy + 1e-10)

    mel_mean = log_mel.mean(axis=0)
    mel_std = log_mel.std(axis=0)

    # Band-energy ratios from the mean power spectrum across frames
    mean_power = power.mean(axis=0)           # (n_bins,)
    n_bins = NFFT // 2 + 1
    fft_freqs = np.linspace(0.0, SR / 2.0, n_bins)
    total = mean_power.sum() + 1e-10
    ratios = []
    for (lo, hi) in BAND_RATIOS:
        mask = (fft_freqs >= lo) & (fft_freqs < hi)
        ratios.append(mean_power[mask].sum() / total)
    ratios = np.array(ratios)

    feat = np.concatenate([mel_mean, mel_std, ratios]).astype(np.float64)
    return feat


if __name__ == "__main__":
    # Self-test: print the feature dimension and a sanity vector.
    t = np.linspace(0, 2.0, int(SR * 2.0), endpoint=False)
    tone = np.sin(2 * np.pi * 1000 * t) * 0.3
    f = extract_features(tone)
    print("FEATURE_DIM =", FEATURE_DIM, "| extracted len =", len(f))
    print("mel filterbank shape =", MEL_FB.shape)
    print("first 6 feats:", np.round(f[:6], 3))
