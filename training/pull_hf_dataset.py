"""
pull_hf_dataset.py -- reproduce the drone-audio subset from HuggingFace
`geronimobasso/drone-audio-detection-samples` (MIT). Binary: label 0 = background
(~9s), label 1 = drone (~0.5s). Streams the background half; pulls the drone half
from a late parquet shard (the file is label-ordered). No torch/torchcodec needed
(reads raw audio bytes with soundfile). See docs/GUARD-VIGIL-INTEGRATION.md.

  pip install "datasets>=2.19" soundfile pyarrow scipy
  python training/pull_hf_dataset.py <out_dir> [n_none] [n_drone]
Outputs <out_dir>/none/*.wav and <out_dir>/drone/*.wav (16 kHz mono, drone tiled to 2s).
"""
import os, sys, io, numpy as np, soundfile as sf
from math import gcd
from scipy.signal import resample_poly
OUT=sys.argv[1]; N0=int(sys.argv[2]) if len(sys.argv)>2 else 600; N1=int(sys.argv[3]) if len(sys.argv)>3 else 1200
DS="geronimobasso/drone-audio-detection-samples"; TGT=32000
def to16k(y,sr):
    if y.ndim>1: y=y.mean(axis=1)
    if sr!=16000: g=gcd(int(sr),16000); y=resample_poly(y,16000//g,int(sr)//g)
    mx=float(np.max(np.abs(y)));  y=y/mx*0.98 if mx>0 else y
    return y.astype(np.float32)
os.makedirs(os.path.join(OUT,"none"),exist_ok=True); os.makedirs(os.path.join(OUT,"drone"),exist_ok=True)
# --- background (label 0): stream the head ---
from datasets import load_dataset, Audio
ds=load_dataset(DS,split="train",streaming=True).cast_column("audio",Audio(decode=False))
n=0
for ex in ds:
    if int(ex["label"])!=0: continue
    b=ex["audio"].get("bytes");
    if not b: continue
    try: y,sr=sf.read(io.BytesIO(b),dtype="float32")
    except Exception: continue
    if len(y)<int(16000*0.4): continue
    sf.write(os.path.join(OUT,"none",f"hf_none_{n:04d}.wav"),to16k(y,sr),16000,subtype="PCM_16"); n+=1
    if n>=N0: break
print(f"background(none): {n}")
# --- drone (label 1): read a late parquet shard directly ---
import urllib.request, json, pyarrow.parquet as pq
meta=json.load(urllib.request.urlopen(f"https://datasets-server.huggingface.co/parquet?dataset={DS}"))
url=[f["url"] for f in meta["parquet_files"] if f["url"].endswith("0038.parquet")][0]
urllib.request.urlretrieve(url, os.path.join(OUT,"_shard.parquet"))
t=pq.read_table(os.path.join(OUT,"_shard.parquet")); m=0
for lab,a in zip(t.column("label").to_pylist(), t.column("audio").to_pylist()):
    if int(lab)!=1: continue
    b=a.get("bytes") if isinstance(a,dict) else None
    if not b: continue
    try: y,sr=sf.read(io.BytesIO(b),dtype="float32")
    except Exception: continue
    y=to16k(y,sr)
    if len(y)<TGT: y=np.tile(y,int(np.ceil(TGT/len(y))))[:TGT]  # tile 0.5s -> 2s
    sf.write(os.path.join(OUT,"drone",f"hf_drone_{m:04d}.wav"),y[:TGT],16000,subtype="PCM_16"); m+=1
    if m>=N1: break
os.remove(os.path.join(OUT,"_shard.parquet"))
print(f"drone: {m}")
