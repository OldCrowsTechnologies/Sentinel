"""
corvus_synth.py
===============
Physically-grounded synthetic acoustic signature generator for Corvus Sentinel.

This is a BOOTSTRAP data source. It produces labeled training clips whose
spectral structure matches the documented blade-pass signatures of each
platform, so the classifier learns to key on the rotor harmonic comb -- the
same cue it will see from real audio.

For PRODUCTION accuracy, replace/augment this with real recordings
(DADS, DroneAudioset, and your own Skydio X2 captures). `train_corvus.py`
takes a `--data DIR` flag for exactly that; the synthetic path is the
fallback when no real corpus is available.

Each clip is CLIP_SEC seconds of mono float32 at SR Hz.
"""

import numpy as np
from corvus_features import SR, LABELS

CLIP_SEC = 2.0
N_SAMPLES = int(SR * CLIP_SEC)

# Per-platform fundamental (blade-pass) frequency ranges, in Hz.
# Values from corvus-sentinel-project.md acoustic profiles.
DRONE_PROFILES = {
    # --- Acoustic size categories (fallback when brand isn't ear-separable) ---
    # Small props spin fast -> high blade-pass; big props slow -> low.
    "Small multirotor":  {"f0": (1400, 2200), "n_harm": 5, "rolloff": 0.60},
    "Medium multirotor": {"f0": (800, 1400),  "n_harm": 5, "rolloff": 0.65},
    "Large multirotor":  {"f0": (300, 650),   "n_harm": 6, "rolloff": 0.72},
    # FPV racers: small 5-6" props at very high RPM + aggressive throttle.
    "FPV racer":         {"f0": (1600, 3200), "n_harm": 6, "rolloff": 0.55},
    # --- Flagship specific models ---
    "Skydio X2":    {"f0": (800, 1400),  "n_harm": 5, "rolloff": 0.65},
    "DJI Phantom":  {"f0": (1200, 1800), "n_harm": 4, "rolloff": 0.70},
    "Parrot Anafi": {"f0": (920, 1200),  "n_harm": 4, "rolloff": 0.60},
    # Potensic Atom 2 = sub-250 g micro; measured low ~330 Hz blade-pass comb
    # (field capture, kpitts 2026-06-29) -- distinctly lower than the others.
    "Potensic Atom 2": {"f0": (300, 380), "n_harm": 5, "rolloff": 0.60},
    # Manned rotorcraft (helicopter) = crewed aircraft, NOT a UAS/threat. This is
    # a PLACEHOLDER: real turbine-helo audio is dominated by transmission/turbine
    # whine + a very-low, dense main-rotor comb (mostly below the 400 Hz high-pass).
    # A simple rotor-comb can't capture that faithfully -- it only reserves the
    # class so the pipeline is coherent. REPLACE with real captures before trusting
    # (data/recordings/Manned rotorcraft/); the model should learn this from real audio.
    "Manned rotorcraft": {"f0": (500, 900), "n_harm": 9, "rolloff": 0.85},
    # Unknown = drone-like comb but fundamental outside the known bands
    "Unknown":      {"f0": (450, 700),   "n_harm": 5, "rolloff": 0.65},
}


def _pink_noise(n, rng):
    """Approximate pink (1/f) noise via spectral shaping."""
    white = rng.standard_normal(n)
    X = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    freqs[0] = freqs[1]
    X = X / np.sqrt(freqs)
    out = np.fft.irfft(X, n=n)
    return out / (np.max(np.abs(out)) + 1e-9)


def _rotor_comb(rng, f0_range, n_harm, rolloff):
    """Synthesize a quadcopter rotor harmonic comb with AM/FM jitter."""
    t = np.arange(N_SAMPLES) / SR
    f0 = rng.uniform(*f0_range)

    # Slow frequency drift (throttle changes) + fine vibrato
    drift = 1.0 + 0.02 * np.sin(2 * np.pi * rng.uniform(0.2, 0.8) * t)
    vibrato = 1.0 + 0.004 * rng.standard_normal(N_SAMPLES).cumsum() / np.sqrt(N_SAMPLES)
    inst_f0 = f0 * drift * vibrato

    sig = np.zeros(N_SAMPLES)
    phase = 2 * np.pi * np.cumsum(inst_f0) / SR
    for h in range(1, n_harm + 1):
        amp = (rolloff ** (h - 1)) * rng.uniform(0.85, 1.15)
        # Rotor AM wobble (4 rotors slightly out of sync -> beating)
        am = 1.0 + 0.25 * np.sin(2 * np.pi * rng.uniform(6, 16) * t + rng.uniform(0, 6.28))
        sig += amp * am * np.sin(h * phase)

    # Broadband motor/airflow noise beneath the comb
    sig += 0.30 * _pink_noise(N_SAMPLES, rng)
    return sig


def _negative(rng):
    """Synthesize a 'None' (no drone) clip: ambience, wind, speech-band, tones."""
    t = np.arange(N_SAMPLES) / SR
    kind = rng.integers(0, 4)
    if kind == 0:                       # urban / pink ambience
        sig = 0.8 * _pink_noise(N_SAMPLES, rng)
    elif kind == 1:                     # wind: low-freq modulated noise
        base = _pink_noise(N_SAMPLES, rng)
        env = 0.5 + 0.5 * np.abs(np.sin(2 * np.pi * rng.uniform(0.3, 1.2) * t))
        sig = base * env
        # emphasize <300 Hz
        X = np.fft.rfft(sig)
        freqs = np.fft.rfftfreq(N_SAMPLES, 1.0 / SR)
        X[freqs > 400] *= 0.2
        sig = np.fft.irfft(X, n=N_SAMPLES)
    elif kind == 2:                     # speech-like formant bursts
        sig = np.zeros(N_SAMPLES)
        for f in rng.uniform(200, 3000, size=rng.integers(2, 5)):
            burst = np.sin(2 * np.pi * f * t) * (rng.random() > 0.5)
            env = np.clip(np.sin(2 * np.pi * rng.uniform(2, 6) * t), 0, 1)
            sig += 0.3 * burst * env
        sig += 0.2 * _pink_noise(N_SAMPLES, rng)
    else:                               # stray single tones (HVAC, alarms) outside comb structure
        sig = np.zeros(N_SAMPLES)
        for f in rng.uniform(2000, 6000, size=rng.integers(1, 3)):
            sig += 0.4 * np.sin(2 * np.pi * f * t)
        sig += 0.3 * _pink_noise(N_SAMPLES, rng)
    return sig


# ---------------------------------------------------------------------------
# Non-rotor signature generators (the full-taxonomy classes). Bootstrap only --
# real captures replace these. Each returns CLIP_SEC of mono float at SR.
# ---------------------------------------------------------------------------
def _bird(rng):
    """Bird/biological: short tonal chirps & sweeps, mid-high band, bursty
    (non-stationary -> the stationarity gate should knock this DOWN, teaching the
    model 'a chirp is not a rotor')."""
    sig = np.zeros(N_SAMPLES)
    for _ in range(int(rng.integers(2, 6))):
        f0 = rng.uniform(1800, 5500)
        dur = rng.uniform(0.05, 0.25)
        start = rng.uniform(0, max(1e-3, CLIP_SEC - dur))
        i0 = int(start * SR)
        i1 = min(N_SAMPLES, i0 + int(dur * SR))
        m = i1 - i0
        if m < 2:
            continue
        tt = np.arange(m) / SR
        sweep = f0 * (1.0 + rng.uniform(-0.3, 0.3) * (tt / max(dur, 1e-3)))
        phase = 2 * np.pi * np.cumsum(sweep) / SR
        sig[i0:i1] += rng.uniform(0.5, 1.0) * np.hanning(m) * np.sin(phase)
    sig += 0.05 * _pink_noise(N_SAMPLES, rng)
    return sig


def _prop(rng):
    """Fixed-wing UAS: single steady prop -- low fundamental, clean harmonic
    stack, little of the 4-rotor beating a multirotor has, plus airflow hiss."""
    t = np.arange(N_SAMPLES) / SR
    f0 = rng.uniform(150, 600)
    drift = 1.0 + 0.01 * np.sin(2 * np.pi * rng.uniform(0.1, 0.4) * t)
    phase = 2 * np.pi * np.cumsum(f0 * drift) / SR
    sig = np.zeros(N_SAMPLES)
    for h in range(1, 7):
        sig += (0.7 ** (h - 1)) * rng.uniform(0.9, 1.1) * np.sin(h * phase)
    sig += 0.40 * _pink_noise(N_SAMPLES, rng)  # steady prop wash
    return sig


def _engine(rng):
    """Combustion / one-way-attack UAS (Shahed-class): LOW engine-firing
    fundamental (~40-130 Hz) with MANY harmonics reaching high, irregular piston
    AM, and heavy broadband exhaust. This is the class the old 400 Hz high-pass
    erased -- it only survives with the 40 Hz corner."""
    t = np.arange(N_SAMPLES) / SR
    f0 = rng.uniform(40, 130)
    drift = (1.0 + 0.03 * np.sin(2 * np.pi * rng.uniform(0.2, 1.0) * t)
             + 0.01 * rng.standard_normal(N_SAMPLES).cumsum() / np.sqrt(N_SAMPLES))
    phase = 2 * np.pi * np.cumsum(f0 * drift) / SR
    sig = np.zeros(N_SAMPLES)
    n_harm = int(rng.integers(10, 20))
    for h in range(1, n_harm + 1):
        am = 1.0 + 0.4 * np.sin(2 * np.pi * rng.uniform(3, 12) * t + rng.uniform(0, 6.28))
        sig += (0.82 ** (h - 1)) * rng.uniform(0.7, 1.3) * am * np.sin(h * phase)
    sig += 0.50 * _pink_noise(N_SAMPLES, rng)
    return sig


def _jet(rng):
    """Manned fixed-wing / jet: dominant broadband roar + a few high turbine
    whine tones + low rumble. The loud 'must NOT trigger' negative."""
    t = np.arange(N_SAMPLES) / SR
    roar = _pink_noise(N_SAMPLES, rng)
    sig = np.zeros(N_SAMPLES)
    for _ in range(int(rng.integers(1, 4))):  # turbine whine tones
        f = rng.uniform(2000, 6000)
        drift = 1.0 + 0.02 * np.sin(2 * np.pi * rng.uniform(0.1, 0.5) * t)
        phase = 2 * np.pi * np.cumsum(f * drift) / SR
        sig += rng.uniform(0.15, 0.4) * np.sin(phase)
    low = _pink_noise(N_SAMPLES, rng)
    X = np.fft.rfft(low)
    freqs = np.fft.rfftfreq(N_SAMPLES, 1.0 / SR)
    X[freqs > 300] *= 0.2
    low = np.fft.irfft(X, n=N_SAMPLES)
    return sig + 0.8 * roar + 0.6 * low


# Classes synthesized by a dedicated (non-rotor) generator.
SPECIAL_SYNTH = {
    "Bird": _bird,
    "Fixed-wing UAS": _prop,
    "Combustion UAS": _engine,
    "Manned fixed-wing": _jet,
}


def make_clip(label, rng, snr_db=None):
    """Generate one labeled clip with randomized SNR and gain."""
    if label == "None":
        sig = _negative(rng)
    else:
        if label in SPECIAL_SYNTH:
            sig = SPECIAL_SYNTH[label](rng)
        else:
            p = DRONE_PROFILES[label]
            sig = _rotor_comb(rng, p["f0"], p["n_harm"], p["rolloff"])
        # Mix in background noise at a randomized SNR to model distance/environment
        if snr_db is None:
            snr_db = rng.uniform(-5, 20)   # -5 dB (far/noisy) .. 20 dB (close/quiet)
        noise = _pink_noise(N_SAMPLES, rng)
        sig_p = np.mean(sig ** 2) + 1e-12
        noise_p = np.mean(noise ** 2) + 1e-12
        k = np.sqrt(sig_p / (noise_p * (10 ** (snr_db / 10))))
        sig = sig + k * noise

    # Normalize then apply random overall gain (mic distance/level)
    sig = sig / (np.max(np.abs(sig)) + 1e-9)
    sig = sig * rng.uniform(0.2, 0.95)
    return sig.astype(np.float32)


def build_synthetic_dataset(per_class=400, seed=1337):
    """Return (X_waveforms list, y labels list of ints)."""
    rng = np.random.default_rng(seed)
    waves, labels = [], []
    for li, label in enumerate(LABELS):
        if (label != "None" and label not in DRONE_PROFILES
                and label not in SPECIAL_SYNTH):
            continue  # real-data-only class (no synthetic profile) -- learned from field audio
        for _ in range(per_class):
            waves.append(make_clip(label, rng))
            labels.append(li)
    return waves, np.array(labels)


if __name__ == "__main__":
    w, y = build_synthetic_dataset(per_class=3)
    print("clips:", len(w), "| sample clip shape:", w[0].shape, "| labels:", y)
