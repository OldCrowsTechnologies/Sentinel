#!/bin/bash
# run_parity.sh -- proves lib/dsp.ts + lib/mlClassifier.ts match the Python
# trainer exactly (train/inference parity). Requires python3 + node >= 22.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "[1/2] Generating reference cases (Python)..."
python3 "$HERE/verify_parity.py"

echo "[2/2] Running on-device TS pipeline (Node) ..."
T="$(mktemp -d)"
cp "$ROOT/lib/dsp.ts" "$T/dsp.ts"
cp "$ROOT/lib/config.ts" "$T/config.ts"
# Node ESM needs explicit .ts extensions; Metro does not, so we patch copies.
sed "s#from './dsp'#from './dsp.ts'#g" "$ROOT/lib/vad.ts" > "$T/vad.ts"
sed -e "s#from './dsp'#from './dsp.ts'#g" \
    -e "s#from './vad'#from './vad.ts'#g" \
    -e "s#from './config'#from './config.ts'#g" \
    "$ROOT/lib/mlClassifier.ts" > "$T/mlClassifier.ts"
cp "$ROOT/assets/models/corvus-model.json" "$T/model.json"
cp "$HERE/parity_cases.json" "$T/parity_cases.json"
cat > "$T/run.mjs" <<'EOF'
import fs from 'node:fs';
import { extractFeatures } from './dsp.ts';
import { standardize, forwardMLP } from './mlClassifier.ts';
const model = JSON.parse(fs.readFileSync(new URL('./model.json', import.meta.url),'utf8'));
const { cases } = JSON.parse(fs.readFileSync(new URL('./parity_cases.json', import.meta.url),'utf8'));
const cfg={sampleRate:model.dsp.sampleRate,nfft:model.dsp.nfft,hop:model.dsp.hop,nMels:model.dsp.nMels,bandRatios:model.dsp.bandRatios,melFilterbank:model.dsp.melFilterbank,highPass:model.dsp.highPass};
let maxAbs=0,maxProb=0,match=0;
for(const c of cases){
  const f=extractFeatures(Float64Array.from(c.samples),cfg);
  for(let i=0;i<c.pyFeat.length;i++) maxAbs=Math.max(maxAbs,Math.abs(c.pyFeat[i]-f[i]));
  const probs=forwardMLP(standardize(f,model),model);
  for(let i=0;i<probs.length;i++) maxProb=Math.max(maxProb,Math.abs(probs[i]-c.pyProbs[i]));
  const jt=probs.indexOf(Math.max(...probs)),pt=c.pyProbs.indexOf(Math.max(...c.pyProbs));
  if(jt===pt)match++;
  console.log('  true='+c.label.padEnd(13)+' pred='+model.labels[jt].padEnd(13)+' '+(probs[jt]*100).toFixed(1)+'%  '+(jt===pt?'OK':'MISMATCH'));
}
console.log('\nmax feature abs diff: '+maxAbs.toExponential(3));
console.log('max prob abs diff:    '+maxProb.toExponential(3));
console.log('class agreement:      '+match+'/'+cases.length);
if(maxAbs<1e-6&&maxProb<1e-6&&match===cases.length){console.log('PARITY OK');process.exit(0);}else{console.log('PARITY FAIL');process.exit(1);}
EOF
node --experimental-strip-types "$T/run.mjs"
rm -rf "$T"
