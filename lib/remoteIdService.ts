/**
 * remoteIdService.ts -- Tier-2 phone-native RF: receive drone Remote ID
 * (ASTM F3411 / OpenDroneID) over Bluetooth. Scans BLE advertisements, parses
 * the ASTM 0xFFFA service data (openDroneId.ts), and aggregates per device --
 * since a drone spreads message types across packets.
 *
 * IMPORTANT: only COMPLIANT drones broadcast Remote ID. Homemade / hostile
 * drones usually won't -- those remain an acoustic (Tier-1) or SDR (Tier-3)
 * problem. Needs on-device validation against a real RID broadcaster.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { parseServiceData, base64ToBytes, RemoteIdParsed } from './openDroneId';

const ODID_UUID = '0000fffa-0000-1000-8000-00805f9b34fb';

export interface RemoteIdContact {
  id: string;
  uasId?: string;
  uaType?: number;
  droneLat?: number;
  droneLon?: number;
  operatorLat?: number;
  operatorLon?: number;
  operatorId?: string;
  rssi?: number;
  firstSeen: number;
  lastSeen: number;
}

let manager: BleManager | null = null;
let scanning = false;
const contacts = new Map<string, RemoteIdContact>();

async function requestPerms(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const want = [P.ACCESS_FINE_LOCATION, P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT].filter(Boolean);
  try {
    const res = await PermissionsAndroid.requestMultiple(want as any);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

function ensurePoweredOn(m: BleManager): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    const sub = m.onStateChange((st) => {
      if (st === 'PoweredOn') {
        sub.remove();
        finish(true);
      }
    }, true);
    setTimeout(() => {
      sub.remove();
      finish(false);
    }, 5000);
  });
}

function merge(device: Device, p: RemoteIdParsed): void {
  const now = Date.now();
  const prev = contacts.get(device.id);
  const c: RemoteIdContact = prev ?? { id: device.id, firstSeen: now, lastSeen: now };
  if (p.uasId) c.uasId = p.uasId;
  if (p.uaType != null) c.uaType = p.uaType;
  if (p.droneLat != null && Math.abs(p.droneLat) <= 90) c.droneLat = p.droneLat;
  if (p.droneLon != null && Math.abs(p.droneLon) <= 180) c.droneLon = p.droneLon;
  if (p.operatorLat != null && Math.abs(p.operatorLat) <= 90) c.operatorLat = p.operatorLat;
  if (p.operatorLon != null && Math.abs(p.operatorLon) <= 180) c.operatorLon = p.operatorLon;
  if (p.operatorId) c.operatorId = p.operatorId;
  c.rssi = device.rssi ?? c.rssi;
  c.lastSeen = now;
  contacts.set(device.id, c);
}

/** Start scanning. Returns false if permission/BLE unavailable. */
export async function startRemoteIdScan(
  onUpdate: (contacts: RemoteIdContact[]) => void
): Promise<boolean> {
  if (scanning) return true;
  if (!(await requestPerms())) return false;
  try {
    if (!manager) manager = new BleManager();
  } catch {
    return false;
  }
  if (!(await ensurePoweredOn(manager))) return false;

  scanning = true;
  manager.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
    if (err || !device || !device.serviceData) return;
    // ble-plx returns lowercased UUID keys
    const sd = device.serviceData[ODID_UUID];
    if (!sd) return;
    const parsed = parseServiceData(base64ToBytes(sd));
    if (!parsed) return;
    merge(device, parsed);
    onUpdate(Array.from(contacts.values()));
  });
  return true;
}

export function stopRemoteIdScan(): void {
  if (manager && scanning) {
    try {
      manager.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }
  scanning = false;
}

export function isScanning(): boolean {
  return scanning;
}

export function getRemoteIdContacts(): RemoteIdContact[] {
  return Array.from(contacts.values());
}

export function clearRemoteIdContacts(): void {
  contacts.clear();
}
