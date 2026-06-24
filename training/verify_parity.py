"""
verify_parity.py -- emit test clips + Python feature vectors AND reference
classifier probabilities (computed from the exported model JSON) so the
on-device TypeScript pipeline can be checked for exact parity.

Run:  python3 verify_parity.py
Then: (see verify_parity.mjs)
"""
import json
import os
import numpy as np
from corvus_features import extract_features, FEATURE_DIM
from corvus_synth import build_synthetic_dataset, LABELS

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "..", "assets", "models", "corvus-model.json")


def forward_from_json(feat, model):
    """Reference forward pass using the EXPORTED json (mirrors mlClassifier.ts)."""
    mean = np.array(model["scaler"]["mean"])
    scale = np.array(model["scaler"]["scale"])
    a = (np.array(feat) - mean) / scale
    for layer in model["mlp"]["layers"]:
        W = np.array(layer["W"])
        b = np.array(layer["b"])
        z = a @ W + b
        if layer["activation"] == "relu":
            a = np.maximum(z, 0)
        else:
            z = z - z.max()
            e = np.exp(z)
            a = e / e.sum()
    return a


def main():
    with open(MODEL) as f:
        model = json.load(f)
    waves, y = build_synthetic_dataset(per_class=1, seed=4242)
    cases = []
    for w, li in zip(waves, y):
        feat = extract_features(w)
        probs = forward_from_json(feat, model)
        cases.append({
            "label": LABELS[int(li)],
            "samples": [float(v) for v in w],
            "pyFeat": [float(v) for v in feat],
            "pyProbs": [float(v) for v in probs],
        })
    out = os.path.join(HERE, "parity_cases.json")
    with open(out, "w") as f:
        json.dump({"featureDim": FEATURE_DIM, "cases": cases}, f)
    print("wrote", out, "with", len(cases), "cases, dim=", FEATURE_DIM)


if __name__ == "__main__":
    main()
