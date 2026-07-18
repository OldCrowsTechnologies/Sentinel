/*
 * RtlUsbDevice.kt -- Android USB Host enumeration, permission, claim, and the
 * low-level control-transfer / bulk-endpoint plumbing for an RTL2832U dongle.
 * SKELETON.  License: MIT (in-house, clean-room). Plan §3, §4.1.
 *
 * Clean-room: VID/PID table and the USB control-transfer contract are public
 * facts (udev rules, RTL2832U datasheet, Android USB Host API). No GPL source used.
 */
package com.oldcrows.rtlembedded

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager

/** Known RTL2832U VID/PID pairs (public; same set every open RTL-SDR tool ships). Plan §3.1. */
object RtlIds {
  // (vendorId, productId)
  val KNOWN: Set<Pair<Int, Int>> = setOf(
    0x0BDA to 0x2838, // Realtek generic RTL2832U (most NESDR incl. Nano 3)
    0x0BDA to 0x2832, // RTL2832U (DVB-T variant)
    0x0BDA to 0x2831, // RTL2831U
    0x0BDA to 0x2834, 0x0BDA to 0x2837, 0x0BDA to 0x2839,
    0x1D19 to 0x1101, 0x1D19 to 0x1102, 0x1D19 to 0x1103, // Dexatek
    0x0CCD to 0x00A9, 0x0CCD to 0x00B3,                   // Terratec
    // TODO(native): extend from the public rtl-sdr known-device list as needed.
  )
  fun matches(d: UsbDevice) = (d.vendorId to d.productId) in KNOWN
}

data class RtlDeviceInfo(
  val deviceName: String,
  val vendorId: Int,
  val productId: Int,
  val hasPermission: Boolean,
  val tuner: String?,
) {
  fun toJsMap(): Map<String, Any?> = mapOf(
    "deviceName" to deviceName,
    "vendorId" to vendorId,
    "productId" to productId,
    "hasPermission" to hasPermission,
    "tuner" to tuner,
  )
}

/**
 * An opened RTL2832U device. Owns the UsbDeviceConnection and exposes the two
 * primitives everything else is built on: ctrl transfers (register access) and
 * the bulk-IN endpoint (IQ). Plan §3.3, §4.1.
 */
class RtlUsbDevice private constructor(
  private val usbDevice: UsbDevice,
  private val connection: UsbDeviceConnection,
  private val iface: UsbInterface,
  val bulkIn: UsbEndpoint,
) {
  val demod = Rtl2832Driver(this)
  val tuner = R820T2Tuner(this)

  fun info() = RtlDeviceInfo(
    usbDevice.deviceName, usbDevice.vendorId, usbDevice.productId, true, tuner.detectedName,
  )

  // ---- register-access primitives (clean-room, derived from RTL2832U datasheet) ----
  // TODO(cleanroom): implement the exact bmRequestType/wValue/wIndex layout for the
  // demod and USB/system address blocks from the datasheet. These signatures capture
  // the contract; the byte layout is the reverse-validation point (plan §4.1, M1).

  /** Write a value to a demod register at (page, addr). */
  fun demodWrite(page: Int, addr: Int, value: Int, len: Int) {
    // TODO(cleanroom): controlTransfer(host->device, req, wValue=addr, wIndex=page|block, data, len)
  }

  /** Read a demod register at (page, addr). */
  fun demodRead(page: Int, addr: Int, len: Int): Int {
    // TODO(cleanroom): controlTransfer(device->host, ...); return assembled value
    return 0
  }

  /** Write to a USB/system control block register. */
  fun sysWrite(block: Int, addr: Int, value: Int, len: Int) {
    // TODO(cleanroom)
  }

  /**
   * Write a payload to a tuner register via the RTL2832U I2C repeater.
   * R820T2 is at 7-bit I2C addr 0x1A. Plan §4.1, §5.
   */
  fun i2cWrite(i2cAddr: Int, payload: ByteArray) {
    // TODO(cleanroom): enable I2C repeater, wrap payload in a demod ctrl transfer.
  }

  fun i2cRead(i2cAddr: Int, len: Int): ByteArray {
    // TODO(cleanroom)
    return ByteArray(len)
  }

  /** Raw bulk read of IQ. Returns bytes read (interleaved u8 I,Q). Plan §6.1. */
  fun bulkRead(buf: ByteArray, timeoutMs: Int): Int =
    connection.bulkTransfer(bulkIn, buf, buf.size, timeoutMs)

  fun close() {
    try { connection.releaseInterface(iface) } finally { connection.close() }
  }

  companion object {
    fun list(usb: UsbManager): List<RtlDeviceInfo> =
      usb.deviceList.values.filter(RtlIds::matches).map {
        RtlDeviceInfo(it.deviceName, it.vendorId, it.productId, usb.hasPermission(it), null)
      }

    fun hasPermission(usb: UsbManager, deviceName: String): Boolean =
      usb.deviceList.values.firstOrNull { it.deviceName == deviceName }?.let(usb::hasPermission) ?: false

    /** Open + claim interface 0, locate the bulk-IN endpoint. Plan §3.3. */
    fun open(usb: UsbManager, deviceName: String): RtlUsbDevice? {
      val dev = usb.deviceList.values.firstOrNull { it.deviceName == deviceName } ?: return null
      if (!usb.hasPermission(dev)) return null
      val conn = usb.openDevice(dev) ?: return null
      val iface = dev.getInterface(0)
      if (!conn.claimInterface(iface, /*force=*/true)) { conn.close(); return null }
      val bulkIn = (0 until iface.endpointCount).map(iface::getEndpoint).firstOrNull {
        it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_IN
      } ?: run { conn.releaseInterface(iface); conn.close(); return null }
      return RtlUsbDevice(dev, conn, iface, bulkIn)
    }
  }
}
