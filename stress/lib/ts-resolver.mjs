/**
 * ts-resolver.mjs -- module resolution hook for the stress harness.
 *
 * The Corvus library uses extensionless relative imports (`import './dsp'`),
 * which Metro/Expo resolve at bundle time but Node's ESM loader does not. This
 * hook retries a failed extensionless relative specifier with a `.ts` suffix so
 * the harness can import the REAL classifier graph unchanged -- no shims, no
 * forked copies of the detection code. Combined with `--experimental-strip-types`
 * (which strips the TypeScript types at load), it runs lib/*.ts as-is.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExt = /\.[mc]?[jt]s$|\.json$/.test(specifier);
    if (relative && !hasExt) {
      return await nextResolve(specifier + '.ts', context);
    }
    throw err;
  }
}
