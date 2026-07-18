/*
 * IqStreamer.kt -- USB bulk IQ streaming loop. Reads raw interleaved u8 I,Q from
 * the RTL2832U bulk-IN endpoint on a background thread and hands each chunk to a
 * sink (which forwards it to JS as the 'onIqData' event). SKELETON.
 * License: MIT (in-house, clean-room). Plan §6.
 *
 * The bytes are NOT transformed: they are already exactly what lib/rtlTcp.decodeIqU8
 * expects (interleaved unsigned-8-bit I,Q, bias 127.5). Plan §6.2.
 */
package com.oldcrows.rtlembedded

import java.util.concurrent.atomic.AtomicBoolean

class IqStreamer(
  private val dev: RtlUsbDevice,
  private val onChunk: (ByteArray) -> Unit,
) {
  private val running = AtomicBoolean(false)
  private var thread: Thread? = null

  /** ~one 32768-sample frame (rfSensorService.FRAME_SAMPLES) = 65536 bytes. Plan §6.1. */
  private val bufBytes = 64 * 1024

  fun start() {
    if (!running.compareAndSet(false, true)) return
    thread = Thread({ loop() }, "rtl-iq-stream").apply { isDaemon = true; start() }
  }

  fun stop() {
    running.set(false)
    thread?.join(500)
    thread = null
  }

  private fun loop() {
    val buf = ByteArray(bufBytes)
    // TODO(native): upgrade to the async UsbRequest.queue()/requestWait() double/
    // triple-buffered pattern (pool of ~8-16 buffers) to avoid drops under GC.
    // The sync bulkTransfer path below is adequate for a first bring-up. Plan §6.1.
    while (running.get()) {
      val n = dev.bulkRead(buf, /*timeoutMs=*/1000)
      if (n <= 0) continue // timeout / transient -- keep going
      onChunk(if (n == buf.size) buf.copyOf() else buf.copyOf(n))
    }
  }
}
