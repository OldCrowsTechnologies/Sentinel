import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../lib/theme';
import type { Threat, AlertEvent } from '../lib/threatTracker';

export interface SentinelProps {
  isMonitoring: boolean;
  modelReady: boolean;
  statusText: string;
  level: number; // 0..1 input level meter
  peakLevel: number; // 0..1 peak-hold for the rotate-to-peak locate aid
  onResetPeak: () => void;
  threats: Threat[];
  lastAlert: AlertEvent | null;
  onToggle: () => void;
  onReport: () => void;
  onNavigate: (screen: 'settings' | 'detections') => void;
}

const sevColor = (d: number) => (d < 150 ? COLORS.danger : d < 300 ? COLORS.warning : COLORS.tealLight);

// Range is a loudness estimate, so show a wide band (matches mlClassifier's
// distanceMin/Max factors) rather than a single false-precision number.
const rangeBand = (d: number) => `~${Math.max(30, Math.round(d * 0.65))}–${Math.min(1500, Math.round(d * 1.55))} ft`;

export default function SentinelScreen(props: SentinelProps) {
  const { isMonitoring, modelReady, statusText, level, peakLevel, threats, lastAlert } = props;
  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>CORVUS SENTINEL</Text>
        <View style={[s.badge, { backgroundColor: isMonitoring ? COLORS.tealLight : COLORS.muted }]}>
          <Text style={s.badgeText}>{isMonitoring ? 'ACTIVE' : 'IDLE'}</Text>
        </View>
      </View>

      <Text style={s.status}>{statusText}</Text>

      <View style={s.meterTrack}>
        <View style={[s.meterFill, { width: `${Math.min(100, Math.round(level * 100))}%` }]} />
        <View style={[s.peakMarker, { left: `${Math.min(99, Math.round(peakLevel * 100))}%` }]} />
      </View>

      {isMonitoring && (
        <View style={s.locate}>
          <View style={s.itemRow}>
            <Text style={s.locateTitle}>LOCATE · rotate to peak</Text>
            <TouchableOpacity onPress={props.onResetPeak}>
              <Text style={s.locateReset}>RESET PEAK</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.locateHint}>
            Turn slowly in a full circle. Your body shadows the mic, so the signal peaks when you
            face the contact. Coarse direction aid — not a precise bearing.
          </Text>
          <View style={s.itemRow}>
            <Text style={s.detail}>signal {Math.round(level * 100)}%</Text>
            <Text style={[s.detail, { color: COLORS.gold }]}>peak {Math.round(peakLevel * 100)}%</Text>
          </View>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.cardTitle}>ACTIVE THREATS</Text>
        <Text style={s.count}>{threats.length}</Text>
      </View>

      {threats.length > 0 ? (
        <ScrollView style={s.list}>
          {threats.map((t) => (
            <View key={t.id} style={[s.item, { borderLeftColor: sevColor(t.distance) }]}>
              <View style={s.itemRow}>
                <Text style={s.itemType}>{t.type}</Text>
                <Text style={s.itemConf}>{Math.round(t.confidence)}%</Text>
              </View>
              <View style={s.itemRow}>
                <Text style={s.detail}>{rangeBand(t.distance)}</Text>
                <Text style={s.detail}>{t.bearing >= 0 ? `${Math.round(t.bearing)}°` : 'no bearing'}</Text>
                <Text style={[s.detail, { color: sevColor(t.distance) }]}>{t.status}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={s.empty}>
          <Text style={s.emptyText}>
            {isMonitoring ? 'Listening… no airborne contacts.' : 'Press START to begin monitoring.'}
          </Text>
        </View>
      )}

      {lastAlert && (
        <View style={s.alert}>
          <Text style={s.alertText}>{lastAlert.message}</Text>
        </View>
      )}

      <View style={s.controls}>
        <TouchableOpacity
          style={[s.btn, { backgroundColor: isMonitoring ? COLORS.danger : COLORS.tealLight, opacity: modelReady ? 1 : 0.4 }]}
          disabled={!modelReady}
          onPress={props.onToggle}
        >
          <Text style={s.btnText}>{isMonitoring ? 'STOP' : 'START'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, { backgroundColor: COLORS.gold }]} onPress={props.onReport}>
          <Text style={s.btnText}>REPORT</Text>
        </TouchableOpacity>
      </View>

      <View style={s.controls}>
        <TouchableOpacity style={[s.btnSec]} onPress={() => props.onNavigate('detections')}>
          <Text style={s.btnSecText}>SESSION LOG</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btnSec]} onPress={() => props.onNavigate('settings')}>
          <Text style={s.btnSecText}>SETTINGS</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  badgeText: { fontSize: 11, fontWeight: '700', color: COLORS.darkNavy },
  status: { color: COLORS.muted, fontSize: 12, marginTop: 10 },
  meterTrack: { height: 6, backgroundColor: COLORS.panel, borderRadius: 3, marginTop: 6, marginBottom: 14, position: 'relative' },
  meterFill: { height: 6, backgroundColor: COLORS.tealLight, borderRadius: 3 },
  peakMarker: { position: 'absolute', top: -2, width: 3, height: 10, backgroundColor: COLORS.gold, borderRadius: 1 },
  locate: { backgroundColor: COLORS.panel, borderColor: COLORS.tealDark, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 14 },
  locateTitle: { color: COLORS.tealLight, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  locateReset: { color: COLORS.gold, fontWeight: '700', fontSize: 11, letterSpacing: 1 },
  locateHint: { color: COLORS.muted, fontSize: 11, marginVertical: 6, lineHeight: 15 },
  card: { backgroundColor: COLORS.panel, borderColor: COLORS.tealDark, borderWidth: 1, borderRadius: 8, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 12, color: COLORS.gold, fontWeight: '700', textTransform: 'uppercase' },
  count: { fontSize: 40, fontWeight: '800', color: COLORS.tealLight },
  list: { flex: 1, marginBottom: 12 },
  item: { backgroundColor: COLORS.panel, borderLeftWidth: 4, borderRadius: 6, padding: 12, marginBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  itemType: { color: COLORS.lightGray, fontWeight: '700', fontSize: 15 },
  itemConf: { color: COLORS.gold, fontWeight: '700' },
  detail: { color: COLORS.muted, fontSize: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: COLORS.muted, textAlign: 'center', paddingHorizontal: 24 },
  alert: { backgroundColor: '#E74C3C22', borderColor: COLORS.danger, borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 10 },
  alertText: { color: COLORS.lightGray, fontSize: 13 },
  controls: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 6, alignItems: 'center' },
  btnText: { fontWeight: '800', color: COLORS.darkNavy, letterSpacing: 1 },
  btnSec: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: COLORS.tealDark },
  btnSecText: { fontWeight: '700', color: COLORS.tealLight, fontSize: 12, letterSpacing: 1 },
});
