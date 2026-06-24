/**
 * Parity is run via run_parity.sh, which:
 *   1) runs verify_parity.py to emit reference feature/probability vectors, and
 *   2) executes lib/dsp.ts + lib/mlClassifier.ts (the real on-device code) on
 *      the same inputs and compares (tolerance < 1e-6).
 *
 * Use:  bash training/run_parity.sh      (or: npm run parity)
 *
 * It lives in run_parity.sh because Node's --experimental-strip-types needs
 * explicit .ts import extensions, which the app (Metro) does not use; the
 * script patches a throwaway copy so the shipped source stays idiomatic.
 */
console.log('Run: bash training/run_parity.sh   (or  npm run parity)');
