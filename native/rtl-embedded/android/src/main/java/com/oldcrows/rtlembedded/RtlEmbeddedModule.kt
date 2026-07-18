/*
 * RtlEmbeddedModule.kt -- Expo native module surface for the embedded RTL-SDR
 * driver (Route C). SKELETON.
 *
 * License: MIT (in-house, clean-room). See native/rtl-embedded/README.md.
 * Clean-room: this file only wires Android USB Host + our own driver classes to
 * JS. All register meaning comes from public datasheets (see Rtl2832Driver.kt /
 * R820T2Tuner.kt). librtlsdr (GPL) was NOT used.
 *
 * See docs/RF-EMBEDDED-DRIVER-PLAN.md for the full design.
 */
package com.oldcrows.rtlembedded

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RtlEmbeddedModule : Module() {
  private var device: RtlUsbDevice? = null
  private var streamer: IqStreamer? = null

  private val usbManager: UsbManager
    get() = appContext.reactContext!!.getSystemService(Context.USB_SERVICE) as UsbManager

  companion object {
    private const val ACTION_USB_PERMISSION = "com.oldcrows.rtlembedded.USB_PERMISSION"
  }

  /**
   * Android runtime USB-permission flow (plan §3.2). Resolves true if the user
   * grants (or already granted) access to the matching dongle, false otherwise.
   * Uses a one-shot BroadcastReceiver + a MUTABLE PendingIntent (the system fills
   * in EXTRA_PERMISSION_GRANTED), registered NOT_EXPORTED on API 33+.
   */
  private fun requestUsbPermission(deviceName: String, promise: Promise) {
    val ctx = appContext.reactContext
    if (ctx == null) { promise.resolve(false); return }
    val mgr = usbManager
    val dev = mgr.deviceList.values.firstOrNull { it.deviceName == deviceName }
    if (dev == null) { promise.resolve(false); return }
    if (mgr.hasPermission(dev)) { promise.resolve(true); return }

    val receiver = object : BroadcastReceiver() {
      private var done = false
      override fun onReceive(c: Context, intent: Intent) {
        if (intent.action != ACTION_USB_PERMISSION || done) return
        done = true
        try { ctx.unregisterReceiver(this) } catch (_: Exception) { /* already gone */ }
        promise.resolve(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
      }
    }

    val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    // Explicit to our own package so it survives Android 14's implicit-broadcast limits.
    val intent = Intent(ACTION_USB_PERMISSION).setPackage(ctx.packageName)
    val pi = PendingIntent.getBroadcast(ctx, 0, intent, piFlags)
    val filter = IntentFilter(ACTION_USB_PERMISSION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      ctx.registerReceiver(receiver, filter)
    }
    mgr.requestPermission(dev, pi)
  }

  override fun definition() = ModuleDefinition {
    Name("RtlEmbedded")

    Events("onIqData", "onDeviceDetached", "onError")

    // -- Enumeration / permission ------------------------------------------
    AsyncFunction("listDevices") {
      RtlUsbDevice.list(usbManager).map { it.toJsMap() }
    }

    AsyncFunction("requestPermission") { deviceName: String, promise: Promise ->
      // M0: real Android USB runtime-permission flow (plan §3.2). See
      // requestUsbPermission() -- resolves the promise on the permission broadcast.
      requestUsbPermission(deviceName, promise)
    }

    // -- Open / init -------------------------------------------------------
    AsyncFunction("open") { deviceName: String, config: Map<String, Any?> ->
      val dev = RtlUsbDevice.open(usbManager, deviceName)
        ?: throw IllegalStateException("open failed: $deviceName")
      val sampleRate = (config["sampleRateHz"] as? Number)?.toInt() ?: 1_024_000
      val centerHz = (config["centerHz"] as? Number)?.toInt() ?: 433_920_000
      // Demod + tuner bring-up. Plan §4, §5.
      dev.demod.init(sampleRate)
      dev.tuner.init()
      dev.tuner.setFrequency(centerHz)
      device = dev
      dev.info().toJsMap()
    }

    // -- Runtime setters (Option A high-level path) ------------------------
    AsyncFunction("setCenterFreq") { centerHz: Int -> device?.tuner?.setFrequency(centerHz) ?: Unit }
    AsyncFunction("setSampleRate") { sampleRateHz: Int -> device?.demod?.setSampleRate(sampleRateHz) ?: Unit }
    AsyncFunction("setGain") { gainTenthDb: Int -> device?.tuner?.setGain(gainTenthDb) ?: Unit }

    // -- Runtime setters (Option A raw 5-byte rtl_tcp frame path) ----------
    // Forward the exact command frames RtlTcpClient emits. Plan §7 Option A.
    AsyncFunction("sendCommand") { frame: ByteArray ->
      device?.let { RtlCommand.dispatch(frame, it) }
        ?: throw IllegalStateException("no device open")
    }

    // -- Streaming ---------------------------------------------------------
    AsyncFunction("startStream") {
      val dev = device ?: throw IllegalStateException("no device open")
      val s = IqStreamer(dev) { bytes -> sendEvent("onIqData", mapOf("data" to bytes)) }
      streamer = s
      s.start()
    }

    AsyncFunction("stopStream") {
      streamer?.stop(); streamer = null
    }

    AsyncFunction("close") {
      streamer?.stop(); streamer = null
      device?.close(); device = null
    }

    OnDestroy {
      streamer?.stop()
      device?.close()
    }
  }
}
