/*
 * Rtl2832Driver.kt -- RTL2832U demodulator bring-up: USB FIFO, demod reset,
 * SDR (raw I/Q) mode, DDC IF frequency, and resampler (sample rate). SKELETON.
 * License: MIT (in-house, clean-room). Plan §4.
 *
 * CLEAN-ROOM SOURCE OF REGISTER MEANING:
 *   - Realtek RTL2832U DVB-T COFDM Demodulator + USB 2.0 datasheet (Rev 1.4, public).
 *   - Osmocom / rtl-sdr-blog PROSE docs + Linux kernel dvb-frontends/rtl2832.c read
 *     ONLY as a description of register semantics (never copied as code).
 *   librtlsdr (GPL) was NOT used. Every constant below is TODO until re-derived from
 *   the datasheet and validated on hardware (plan §4.2 confidence notes, M2).
 */
package com.oldcrows.rtlembedded

/** The crystal that clocks both the demod ADC and the tuner. Public standard value. */
const val RTL_XTAL_HZ = 28_800_000.0

class Rtl2832Driver(private val dev: RtlUsbDevice) {

  /** Full demod bring-up to raw-IQ mode at the given sample rate. Plan §4.2. */
  fun init(sampleRateHz: Int) {
    initUsb()
    softReset()
    enableIqMode()
    setIfFrequency(R820T2Tuner.IF_HZ) // demod DDC must cancel the tuner's low-IF
    setSampleRate(sampleRateHz)
    setAgc(auto = true)
    resetFifo()
  }

  /** USB block: enable bulk FIFO / endpoint A in bulk mode, set max transfer size. Plan §4.2(1). */
  private fun initUsb() {
    // TODO(cleanroom): sysWrite() the USB_SYSCTL / USB_EPA_* / USB_EPA_MAXPKT / USB_EPA_CTL
    // sequence from the datasheet USB block. This is well-documented / low risk.
  }

  /** Assert then deassert the demod soft-reset. Plan §4.2(2). */
  private fun softReset() {
    // TODO(cleanroom): toggle DEMOD_CTL soft-reset bit, then release.
  }

  /**
   * Put the demod in SDR mode: bypass DVB-T frame processing and route the ADC's
   * 8-bit I/Q through the DDC to the bulk FIFO. Plan §4.2(3).
   * TODO(hw): the exact enable bits here are the FIRST reverse-validation point (M2)
   * -- expect to confirm on a scope/logic capture that non-zero IQ streams out.
   */
  private fun enableIqMode() {
    // TODO(cleanroom): enable ADC I & Q; select I/Q output path; set demod page mode.
  }

  /**
   * Program the DDC IF frequency (pset_iffreq) via demod page-1 regs 0x19/0x1A/0x1B.
   * if_word = round(if_hz * 2^22 / xtal) with the datasheet's sign convention (negated).
   * Plan §4.2(4). COMPUTE it -- do not hard-code -- to stay clean-room + xtal-portable.
   */
  fun setIfFrequency(ifHz: Double) {
    val word = Math.round(ifHz * (1 shl 22) / RTL_XTAL_HZ)
    val neg = (-word) and 0x3FFFFF // 22-bit two's-complement per datasheet
    // TODO(cleanroom): demodWrite(page=1, 0x19/0x1A/0x1B, neg split into 3 bytes)
    @Suppress("UNUSED_EXPRESSION") neg
  }

  /**
   * Program the resampler ratio (rsamp_ratio) for the requested output sample rate.
   * rsamp_ratio = floor(xtal * 2^22 / rate) & ~3. Plan §4.2(5).
   * Valid rate bands: 225001-300000 or 900001-3200000 Hz.
   */
  fun setSampleRate(rateHz: Int) {
    require(rateHz in 225001..300000 || rateHz in 900001..3200000) {
      "unsupported RTL sample rate: $rateHz"
    }
    val ratio = (Math.round(RTL_XTAL_HZ * (1 shl 22) / rateHz).toInt()) and 0x0FFFFFFC.toInt()
    // TODO(cleanroom): demodWrite the ratio to the page-1 rsamp regs (0x9F/0xA1 region),
    // and optionally the 0x3E/0x3F xtal-error correction (leave 0 for v1).
    @Suppress("UNUSED_EXPRESSION") ratio
  }

  /** Demod digital AGC loop on/off. Plan §4.2(6). */
  fun setAgc(auto: Boolean) {
    // TODO(cleanroom): enable/disable the demod AGC; set spectrum-inversion bit
    // consistent with the IF sign chosen in setIfFrequency().
  }

  /** Flush the bulk FIFO so the first streamed frame is aligned. Plan §4.2(7). */
  fun resetFifo() {
    // TODO(cleanroom): pulse the USB_EPA FIFO reset bits.
  }
}
