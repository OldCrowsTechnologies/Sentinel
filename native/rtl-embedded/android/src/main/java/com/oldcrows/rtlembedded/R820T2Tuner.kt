/*
 * R820T2Tuner.kt -- Rafael Micro R820T2 / R860 tuner: power-up init, IF/tracking
 * filter, fractional-N PLL tuning, and gain. SKELETON.
 * License: MIT (in-house, clean-room). Plan §5.
 *
 * CLEAN-ROOM SOURCE OF REGISTER MEANING:
 *   - R820T2 Register Description PDF (officially released by Rafael Micro; mirrored
 *     publicly by rtl-sdr.com) -- the authoritative public register map.
 *   - R820T datasheet (public).
 *   librtlsdr / r82xx.c (GPL) was NOT used. The init block and gain tables below are
 *   TODO until re-derived from the Register Description PDF (plan §5.1) and validated
 *   on hardware (M3). Register writes go through the RTL2832U I2C repeater.
 *
 * The R860 (newer "v4" NESDR) is register-compatible for our purposes; gate any
 * deltas behind detectedName if a variant needs different values.
 */
package com.oldcrows.rtlembedded

class R820T2Tuner(private val dev: RtlUsbDevice) {

  var detectedName: String? = null
    private set

  /** 32-byte register shadow (0x00-0x1F); 0x00-0x04 are read-only status. Plan §5. */
  private val shadow = ByteArray(32)

  fun init() {
    detectedName = detectTuner()
    writeInitBlock()
    setIf(IF_HZ)
  }

  /** Read the tuner's identity (via a status/chip-id read) to distinguish R820T2 vs R860. */
  private fun detectTuner(): String {
    // TODO(cleanroom): read the chip-id status register through the I2C repeater.
    return "R820T2"
  }

  /**
   * Write the documented power-up init block: LDO/regulator, LNA, mixer, VGA enables
   * and power-management bits -> "tuner active". Plan §5.1.
   * TODO(cleanroom): fill R820T2_INIT from the Register Description PDF, one cite per
   * meaningful byte, then flush the whole shadow via the I2C repeater.
   */
  private fun writeInitBlock() {
    // TODO(cleanroom): populate `shadow` with R820T2_INIT[] and flush.
    flushShadow(from = 5, to = 31)
  }

  /** Set tuner output IF + tracking/image-rejection filter for the current band. Plan §5.2. */
  fun setIf(ifHz: Double) {
    // TODO(cleanroom): program IF filter + tracking filter. For our fixed sub-GHz bands
    // (433/868/915 MHz) a precomputed per-band filter config is sufficient for v1.
  }

  /**
   * Tune the LO to receive `rfHz` at the demod's low-IF. Fractional-N PLL + sigma-delta.
   * Plan §5.3.  All math is PUBLIC (Register Description PDF) -- this is the best-
   * documented part of the stack.
   */
  fun setFrequency(rfHz: Int) {
    val loHz = rfHz + IF_HZ // low-IF: LO sits IF above the RF of interest
    val mixDiv = chooseMixDiv(loHz) // smallest power-of-2 keeping VCO in its valid band
    val vco = loHz.toDouble() * mixDiv
    val nint = Math.floor(vco / (2.0 * RTL_XTAL_HZ)).toInt()
    val vcoFra = vco - 2.0 * RTL_XTAL_HZ * nint
    val sdm = Math.round(vcoFra * 65536.0 / (2.0 * RTL_XTAL_HZ)).toInt() and 0xFFFF

    // TODO(cleanroom): write mixDiv/divider-select reg, nint (integer-N) reg, and the
    // 16-bit sdm across its two regs; then poll PLL-lock (read-only reg 0x02). If not
    // locked near a band edge, nudge by ~0.1/1.0 MHz and re-solve (plan §5.3.4).
    @Suppress("UNUSED_EXPRESSION") Triple(nint, sdm, mixDiv)
  }

  private fun chooseMixDiv(loHz: Int): Int {
    // TODO(cleanroom): pick from the documented VCO band limits. Placeholder shape:
    var div = 2
    while (div < 64 /* TODO: real VCO_MAX/loHz bound */) div = div shl 1
    return div
  }

  /**
   * Gain. gainTenthDb < 0 -> auto/AGC (LNA+mixer+VGA internal AGC); else manual per
   * the documented gain-step tables. Plan §5.4. v1 may ship auto-only.
   */
  fun setGain(gainTenthDb: Int) {
    if (gainTenthDb < 0) {
      // TODO(cleanroom): enable tuner auto-gain (LNA/mixer/VGA AGC).
    } else {
      // TODO(cleanroom): map target dB to LNA/mixer/VGA gain nibbles and write.
    }
  }

  private fun flushShadow(from: Int, to: Int) {
    // TODO(cleanroom): write shadow[from..to] to the tuner via dev.i2cWrite(I2C_ADDR, ...).
  }

  companion object {
    /** R820T2 7-bit I2C address (write addr 0x34). Public. */
    const val I2C_ADDR = 0x1A

    /** R820T2 fixed low-IF the demod DDC is programmed to cancel. Public R820T2 figure. */
    const val IF_HZ = 3_570_000.0
  }
}
