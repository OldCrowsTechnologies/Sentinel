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
# framing) to suppress voice fundamentals (~85-255 Hz) and PA/crowd low end
# while keeping drone rotor signatures (>~400 Hz). This is a FEATURE-PATH change,
# so lib/dsp.ts implements the IDENTICAL recurrence and the model is trained with
# it on -- keep both in lockstep or parity breaks (run_parity.sh).
HIGH_PASS_ENABLED = True
HIGH_PASS_FC = 400.0  # Hz

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

# Drone-band energy ratios (Hz ranges) -- documented blade-pass regions.
# These give the classifier explicit, interpretable handles on each platform.
BAND_RATIOS = [
    (700.0, 1500.0),    # Skydio X2 fundamental region (~800-1400)
    (1100.0, 1900.0),   # DJI Phantom region (~1200-1800)
    (850.0, 1300.0),    # Parrot Anafi region (~920-1200)
    (50.0, 700.0),      # broadband low rumble beneath tonal comb
]
N_BAND_RATIOS = len(BAND_RATIOS)

FEATURE_DIM = 2 * N_MELS + N_BAND_RATIOS

# Class labels (index order is the model output order)
LABELS = [
    "None", "Skydio X2", "DJI Phantom", "Parrot Anafi", "Potensic Atom 2",
    "DJI Mini 3 Pro", "DJI Mini 5 Pro", "DJI FPV", "DJI Mavic 3", "Yuneec",
    "Manned rotorcraft", "Unknown",
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
