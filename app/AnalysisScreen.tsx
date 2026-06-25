/**
 * AnalysisScreen.tsx -- on-device view of the SQLite mission log (the
 * noise-rejection / detection data). Summarizes what the filtering flagged and
 * lets the operator export the raw .db to pull off the phone for tuning.
 *
 * This is the field-independent half: voice/crowd false-positive validation
 * needs no drone -- record voices, then review here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { COLORS } from '../lib/theme';
import { getRecentDetections, MissionLogRow } from '../lib/missionLog';

const DB_PATH = FileSystem.documentDirectory + 'SQLite/corvus-mission.db';

export default function AnalysisScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MissionLogRow[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    getRecentDetections(300).then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => load(), [load]);

  const droneHits = rows.filter((r) => r.droneDetected).length;
  const voiceEvents = rows.filter((r) => r.voicePresent).length;
  const voiceAndDrone = rows.filter((r) => r.voicePresent && r.droneDetected).length;

  const exportDb = async () => {
    setStatus('Preparing export…');
    try {
      const info = await FileSystem.getInfoAsync(DB_PATH);
      if (!info.exists) {
        setStatus('No log yet — run monitoring first.');
        return;
      }
      if (!(await Sharing.isAvailableAsync())) {
        setStatus('Sharing unavailable on this device.');
        return;
      }
      await Sharing.shareAsync(DB_PATH, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Corvus mission log (SQLite)',
      });
      setStatus('');
    } catch (e) {
      setStatus('Export failed: ' + String(e));
    }
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.back}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={s.title}>ANALYSIS</Text>
        <TouchableOpacity onPress={load}>
          <Text style={s.back}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      <View style={s.summary}>
        <Stat label="LOGGED" value={rows.length} />
        <Stat label="DRONE" value={droneHits} color={COLORS.tealLight} />
        <Stat label="VOICE" value={voiceEvents} color={COLORS.gold} />
        <Stat label="BOTH" value={voiceAndDrone} color={COLORS.warning} />
      </View>
      <Text style={s.hint}>
        "VOICE" = windows the VAD flagged as speech. "BOTH" = a drone call during speech (where the
        confidence gating kicks in). Record voices/crowd with no drone up — DRONE should stay ~0.
      </Text>

      <ScrollView style={s.list}>
        {rows.map((r, i) => (
          <View key={i} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>
                {r.droneDetected ? r.label : 'None'}{' '}
                <Text style={s.rowConf}>{Math.round(r.confidence)}%</Text>
              </Text>
              <Text style={s.rowMeta}>
                {new Date(r.ts).toLocaleTimeString()} · peak {(r.filteredAudioPeak ?? 0).toFixed(3)}
              </Text>
            </View>
            {r.droneDetected ? <Tag text="DRONE" color={COLORS.tealLight} /> : null}
            {r.voicePresent ? <Tag text="VOICE" color={COLORS.gold} /> : null}
          </View>
        ))}
        {rows.length === 0 && <Text style={s.empty}>No log entries yet. Run monitoring, then refresh.</Text>}
      </ScrollView>

      <TouchableOpacity style={s.btn} onPress={exportDb}>
        <Text style={s.btnText}>EXPORT LOG (.db)</Text>
      </TouchableOpacity>
      {status ? <Text style={s.status}>{status}</Text> : null}
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, color && { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <View style={[s.tag, { borderColor: color }]}>
      <Text style={[s.tagText, { color }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10 },
  back: { color: COLORS.tealLight, fontWeight: '700', fontSize: 12 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, backgroundColor: COLORS.panel, borderRadius: 8, padding: 14 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: COLORS.lightGray, fontSize: 26, fontWeight: '800' },
  statLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  hint: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  list: { flex: 1, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panel, borderRadius: 6, padding: 10, marginBottom: 6 },
  rowLabel: { color: COLORS.lightGray, fontWeight: '700', fontSize: 13 },
  rowConf: { color: COLORS.gold, fontWeight: '700' },
  rowMeta: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  tag: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 6 },
  tagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  empty: { color: COLORS.muted, textAlign: 'center', paddingVertical: 24 },
  btn: { backgroundColor: COLORS.tealLight, borderRadius: 6, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  btnText: { color: COLORS.darkNavy, fontWeight: '800', letterSpacing: 1 },
  status: { color: COLORS.tealLight, fontSize: 12, marginTop: 8, textAlign: 'center' },
});
