/**
 * RemoteIdScreen.tsx -- Tier-2 phone-native RF view (TAB). Scans for drone
 * Remote ID (Bluetooth) and lists compliant drones with their broadcast
 * position and, critically, the OPERATOR's position. Honest about coverage:
 * only drones that broadcast Remote ID appear here; homemade / non-cooperative
 * drones won't. Adds an SDR spectrum/waterfall section that is honest about
 * whether an external RF module is actually connected.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Line, Circle } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import {
  AppHeader,
  Panel,
  SectionLabel,
  Pill,
  PrimaryButton,
  EmptyState,
} from './ui';
import { getRfModuleStatus } from '../lib/rfSensorService';
import {
  startRemoteIdScan,
  stopRemoteIdScan,
  clearRemoteIdContacts,
  RemoteIdContact,
} from '../lib/remoteIdService';

// --- static FFT trace (illustrative spectrum, not live IQ) ---
const FFT_W = 320;
const FFT_H = 90;
const FFT_BINS = [
  18, 22, 20, 28, 24, 32, 40, 55, 48, 36, 30, 26, 34, 44, 62, 78, 70, 50, 38,
  30, 28, 33, 41, 36, 29, 25, 31, 27, 23, 26, 22, 20,
];

function fftPoints(): { line: string; fill: string; peak: { x: number; y: number } } {
  const max = Math.max(...FFT_BINS);
  const stepX = FFT_W / (FFT_BINS.length - 1);
  const toY = (v: number) => FFT_H - (v / max) * (FFT_H - 8) - 4;
  let peakIdx = 0;
  FFT_BINS.forEach((v, i) => {
    if (v > FFT_BINS[peakIdx]) peakIdx = i;
  });
  const pts = FFT_BINS.map((v, i) => `${(i * stepX).toFixed(1)},${toY(v).toFixed(1)}`);
  const line = pts.join(' ');
  const fill = `0,${FFT_H} ${line} ${FFT_W},${FFT_H}`;
  return { line, fill, peak: { x: peakIdx * stepX, y: toY(FFT_BINS[peakIdx]) } };
}

// Static "waterfall" rows — colder (faint) -> hotter (teal/gold) toward bins
// with energy. Each row is a fixed band sequence to fake a scrolling display.
const WATERFALL_ROWS: string[][] = [
  [COLORS.faint, COLORS.tealDark, COLORS.teal, COLORS.gold, COLORS.teal, COLORS.tealDark, COLORS.faint, COLORS.faint],
  [COLORS.faint, COLORS.faint, COLORS.tealDark, COLORS.teal, COLORS.teal, COLORS.tealDark, COLORS.faint, COLORS.faint],
  [COLORS.faint, COLORS.tealDark, COLORS.teal, COLORS.teal, COLORS.gold, COLORS.teal, COLORS.tealDark, COLORS.faint],
  [COLORS.faint, COLORS.faint, COLORS.faint, COLORS.tealDark, COLORS.teal, COLORS.tealDark, COLORS.faint, COLORS.faint],
  [COLORS.faint, COLORS.faint, COLORS.tealDark, COLORS.teal, COLORS.teal, COLORS.gold, COLORS.tealDark, COLORS.faint],
];

export default function RemoteIdScreen() {
  const [contacts, setContacts] = useState<RemoteIdContact[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('Idle. Press SCAN to listen for Remote ID.');

  const rf = getRfModuleStatus();
  const fft = fftPoints();

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
    <View style={{ flex: 1 }}>
      <AppHeader
        title="REMOTE ID · RF"
        right={
          <Pill
            label={scanning ? 'SCANNING' : 'IDLE'}
            color={scanning ? COLORS.teal : COLORS.muted}
            dot
          />
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.note}>
          Receives ASTM Remote ID over Bluetooth from compliant drones — gives the
          drone's position and the operator's location. Homemade / non-broadcasting
          drones won't appear here (those are caught acoustically).
        </Text>

        <Text style={s.status}>{status}</Text>

        {/* ---- SPECTRUM ---- */}
        <SectionLabel>SPECTRUM · 2.40–2.48 GHz</SectionLabel>

        {rf.present ? (
          <>
            <Panel style={s.specPanel}>
              <Svg width="100%" height={FFT_H} viewBox={`0 0 ${FFT_W} ${FFT_H}`}>
                {/* faint baseline grid */}
                <Line x1={0} y1={FFT_H - 4} x2={FFT_W} y2={FFT_H - 4} stroke={COLORS.divider} strokeWidth={1} />
                <Line x1={0} y1={FFT_H / 2} x2={FFT_W} y2={FFT_H / 2} stroke={COLORS.divider} strokeWidth={0.5} />
                {/* fill under trace */}
                <Polygon points={fft.fill} fill={COLORS.teal} fillOpacity={0.12} />
                {/* spectrum trace */}
                <Polyline points={fft.line} fill="none" stroke={COLORS.teal} strokeWidth={1.5} />
                {/* peak marker */}
                <Circle cx={fft.peak.x} cy={fft.peak.y} r={3} fill={COLORS.gold} />
              </Svg>
            </Panel>

            <View style={s.waterfall}>
              {WATERFALL_ROWS.map((row, ri) => (
                <View key={ri} style={s.wfRow}>
                  {row.map((c, ci) => (
                    <View key={ci} style={[s.wfCell, { backgroundColor: c }]} />
                  ))}
                </View>
              ))}
            </View>
            <Text style={s.specCaption}>
              SDR FFT + waterfall — illustrative. Peak marked at the active control band.
            </Text>
          </>
        ) : (
          <Panel style={s.offPanel}>
            <MaterialCommunityIcons name="access-point-network-off" size={34} color={COLORS.faint} />
            <Text style={s.offText}>
              SDR module not connected — Bluetooth Remote ID only. {rf.note}
            </Text>
          </Panel>
        )}

        {/* ---- CONTACTS ---- */}
        <View style={s.contactsHead}>
          <SectionLabel style={{ marginTop: 0 }}>REMOTE ID CONTACTS</SectionLabel>
          <Text style={s.count}>{contacts.length}</Text>
        </View>

        {contacts.length > 0 ? (
          contacts.map((c) => (
            <View key={c.id} style={s.item}>
              <View style={s.row}>
                <Text style={s.uas}>{c.uasId || 'UNKNOWN ID'}</Text>
                <Text style={s.rssi}>{c.rssi != null ? `${c.rssi} dBm` : ''}</Text>
              </View>
              <View style={s.kvRow}>
                <Text style={s.kvKey}>DRONE POSITION</Text>
                <Text style={s.kvVal}>{pos(c.droneLat, c.droneLon)}</Text>
              </View>
              <View style={s.kvRow}>
                <Text style={s.kvKey}>OPERATOR POSITION</Text>
                <Text style={[s.kvVal, { color: COLORS.gold }]}>
                  {pos(c.operatorLat, c.operatorLon)}
                </Text>
              </View>
              {c.operatorId ? (
                <View style={s.kvRow}>
                  <Text style={s.kvKey}>OPERATOR ID</Text>
                  <Text style={s.kvVal}>{c.operatorId}</Text>
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <EmptyState
            icon="broadcast"
            text={scanning ? 'Listening… no Remote ID broadcasts yet.' : 'Press SCAN to begin.'}
          />
        )}
      </ScrollView>

      <View style={s.footer}>
        <PrimaryButton
          label={scanning ? 'STOP SCAN' : 'SCAN'}
          icon={scanning ? 'stop' : 'access-point'}
          colors={scanning ? ['#FF5A5F', '#E0353B'] : ['#13B6BB', '#0D7E86']}
          glow={scanning ? COLORS.danger : COLORS.teal}
          onPress={toggle}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  note: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  status: { fontFamily: FONTS.mono, color: COLORS.teal, fontSize: 11.5, marginTop: 8 },

  specPanel: { padding: 12, overflow: 'hidden' },
  waterfall: { marginTop: 8, borderRadius: RADII.sm, overflow: 'hidden' },
  wfRow: { flexDirection: 'row', height: 9 },
  wfCell: { flex: 1, opacity: 0.85 },
  specCaption: { fontFamily: FONTS.body, color: COLORS.faint, fontSize: 10.5, marginTop: 6 },

  offPanel: { padding: 18, alignItems: 'center', flexDirection: 'row', gap: 12 },
  offText: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, lineHeight: 17, flex: 1 },

  contactsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 },
  count: { fontFamily: FONTS.mono, color: COLORS.teal, fontSize: 22, fontWeight: '700' },

  item: {
    backgroundColor: COLORS.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.teal,
    borderRadius: RADII.md,
    padding: 12,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  uas: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 14, letterSpacing: 0.5, flexShrink: 1 },
  rssi: { fontFamily: FONTS.mono, color: COLORS.muted, fontSize: 12, paddingLeft: 10 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  kvKey: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11, letterSpacing: 1 },
  kvVal: { fontFamily: FONTS.mono, color: COLORS.ink, fontSize: 12, flexShrink: 1, textAlign: 'right', paddingLeft: 10 },

  footer: { paddingTop: 10, paddingBottom: 10, flexDirection: 'row' },
});
