/**
 * config.ts -- noise-rejection feature flags (reversible / A-B testing).
 *
 * IMPORTANT parity note: the 400 Hz high-pass changes the features the model
 * sees, so it is TRAINED INTO the model (recorded in model.dsp.highPass) and
 * applied by dsp.ts from there -- guaranteeing train/inference parity. The flag
 * below documents the intended state and drives the TRAINER; flipping it on a
 * model trained the other way would break parity. For a real high-pass A/B,
 * train a second model variant (train_corvus.py --no-highpass) and swap models.
 *
 * The VAD + confidence penalty never touch the model's input, so those ARE
 * safe to toggle at runtime.
 */
export const Config = {
  // Trained-in high-pass (see note above). Read by the trainer.
  ENABLE_HIGH_PASS_FILTER: true,
  HIGH_PASS_FC: 400, // Hz -- removes voice fundamentals (~85-255 Hz)

  // Runtime-safe: VAD only flags voice_present and nudges confidence.
  ENABLE_VAD_CHECK: true,
  VAD_CONFIDENCE_PENALTY: 0.1, // 10% penalty band
};
