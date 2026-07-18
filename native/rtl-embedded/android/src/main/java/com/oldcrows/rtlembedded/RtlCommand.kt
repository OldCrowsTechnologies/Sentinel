/*
 * RtlCommand.kt -- parse the app's existing 5-byte rtl_tcp command frames and
 * dispatch them to the driver. This is the Option-A local RPC: RtlTcpClient
 * (lib/rtlTcp.ts) emits [cmd:u8][param:u32 big-endian]; we decode + apply it
 * WITHOUT a TCP socket. SKELETON. License: MIT. Plan §7 Option A.
 *
 * Command bytes mirror lib/rtlTcp.ts RTL_CMD (public rtl_tcp protocol).
 */
package com.oldcrows.rtlembedded

object RtlCommand {
  private const val SET_FREQ = 0x01
  private const val SET_SAMPLE_RATE = 0x02
  private const val SET_GAIN_MODE = 0x03
  private const val SET_GAIN = 0x04
  private const val SET_FREQ_CORRECTION = 0x05
  private const val SET_AGC_MODE = 0x08

  /** Decode one 5-byte frame and apply it to the open device. */
  fun dispatch(frame: ByteArray, dev: RtlUsbDevice) {
    if (frame.size < 5) return
    val cmd = frame[0].toInt() and 0xFF
    val param = ((frame[1].toInt() and 0xFF) shl 24) or
      ((frame[2].toInt() and 0xFF) shl 16) or
      ((frame[3].toInt() and 0xFF) shl 8) or
      (frame[4].toInt() and 0xFF)
    when (cmd) {
      SET_FREQ -> dev.tuner.setFrequency(param)
      SET_SAMPLE_RATE -> dev.demod.setSampleRate(param)
      SET_GAIN -> dev.tuner.setGain(param) // param in tenths of dB
      SET_GAIN_MODE -> { /* 0=auto,1=manual: TODO route to tuner AGC enable */ }
      SET_AGC_MODE -> dev.demod.setAgc(auto = param != 0)
      SET_FREQ_CORRECTION -> { /* ppm: TODO program demod xtal-error regs 0x3E/0x3F */ }
      else -> { /* ignore unknown commands, as rtl_tcp does */ }
    }
  }
}
