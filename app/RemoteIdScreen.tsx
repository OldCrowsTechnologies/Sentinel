/**
 * RemoteIdScreen.tsx -- Tier-2 phone-native RF view. Scans for drone Remote ID
 * (Bluetooth) and lists compliant drones with their broadcast position and,
 * critically, the OPERATOR's position. Honest about coverage: only drones that
 * broadcast Remote ID appear here; homemade/non-cooperative drones won't.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../lib/theme';
import {
  startRemoteIdScan,
  stopRemoteIdScan,
  clearRemoteIdContacts,
  RemoteIdContact,
} from '../lib/remoteIdService';

export default function RemoteIdScreen({ onBack }: { onBack: () => void }) {
  const [contacts, setContacts] = useState<RemoteIdContact[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('Idle. Press SCAN to listen for Remote ID.');

  const stop = useCallback(() => {
    stopRemoteIdScan();
    setScanning(false);
    setStatus('Stopped.');
  }, []);

  useEffect(() => () => stopRemoteIdScan(), []);

  const toggle = async () => {
    if (scanning) {
      stop();
      return;
    }
    setStatus('Requesting Bluetooth…');
    clearRemoteIdContacts();
    setContacts([]);
    const ok = await startRemoteIdScan((list) => setContacts([...list]));
    if (ok) {
      setScanning(true);
      setStatus('Scanning Bluetooth for Remote ID broadcasts…');
    } else {
      setStatus('Could not start — check Bluetooth + permissions.');
    }
  };

  const pos = (lat?: number, lon?: number) =>
    lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '—';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.back}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={s.title}>REMOTE ID · RF</Text>
        <View style={{ width: 50 }} />
      </View>

      <Text style={s.note}>
        Tier-2 phone-native RF. Receives ASTM Remote ID over Bluetooth from
        COMPLIANT drones — gives the drone's position and the operator's location.
        Homemade / non-broadcasting drones will not appear here (those are caught
        acoustically). Validate against a real Remote ID source.
      </Text>

      <Text style={s.status}>{status}</Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>REMOTE ID CONTACTS</Text>
        <Text style={s.count}>{contacts.length}</Text>
      </View>

      {contacts.length > 0 ? (
        <ScrollView style={s.list}>
          {contacts.map((c) => (
            <View key={c.id} style={s.item}>
              <View style={s.row}>
                <Text style={s.uas}>{c.uasId || 'unknown ID'}</Text>
                <Text style={s.rssi}>{c.rssi != null ? `${c.rssi} dBm` : ''}</Text>
              </View>
              <Text style={s.line}>Drone: {pos(c.droneLat, c.droneLon)}</Text>
              <Text style={[s.line, { color: COLORS.gold }]}>
                Operator: {pos(c.operatorLat, c.operatorLon)}
              </Text>
              {c.operatorId ? <Text style={s.line}>Operator ID: {c.operatorId}</Text> : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={s.empty}>
          <Text style={s.emptyText}>
            {scanning ? 'Listening… no Remote ID broadcasts yet.' : 'Press SCAN to begin.'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.btn, { backgroundColor: scanning ? COLORS.danger : COLORS.tealLight }]}
        onPress={toggle}
      >
        <Text style={s.btnText}>{scanning ? 'STOP SCAN' : 'SCAN'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10 },
  back: { color: COLORS.tealLight, fontWeight: '700', fontSize: 13 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1 },
  note: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  status: { color: COLORS.tealLight, fontSize: 12, marginTop: 10 },
  card: { backgroundColor: COLORS.panel, borderColor: COLORS.tealDark, borderWidth: 1, borderRadius: 8, padding: 16, marginTop: 12, marginBottom: 12 },
  cardTitle: { fontSize: 12, color: COLORS.gold, fontWeight: '700' },
  count: { fontSize: 36, fontWeight: '800', color: COLORS.tealLight },
  list: { flex: 1, marginBottom: 12 },
  item: { backgroundColor: COLORS.panel, borderLeftWidth: 4, borderLeftColor: COLORS.tealLight, borderRadius: 6, padding: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  uas: { color: COLORS.lightGray, fontWeight: '700', fontSize: 14 },
  rssi: { color: COLORS.muted, fontSize: 12 },
  line: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: COLORS.muted, textAlign: 'center', paddingHorizontal: 24 },
  btn: { paddingVertical: 15, borderRadius: 6, alignItems: 'center' },
  btnText: { fontWeight: '800', color: COLORS.darkNavy, letterSpacing: 1 },
});
