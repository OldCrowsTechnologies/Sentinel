/**
 * AnalysisScreen.tsx -- on-device view of the SQLite mission log (the
 * noise-rejection / detection data). Summarizes what the filtering flagged and
 * lets the operator export the raw .db to pull off the phone for tuning.
 *
 * This is the field-independent half: voice/crowd false-positive validation
 * needs no drone -- record voices, then review here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { AppHeader, MetricChip, Pill, PrimaryButton, IconButton, EmptyState } from './ui';
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
    <View style={{ flex: 1 }}>
      <AppHeader title="ANALYSIS" onBack={onBack} right={<IconButton icon="refresh" onPress={load} />} />

      <View style={s.metrics}>
        <MetricChip value={String(rows.length)} label="LOGGED" />
        <MetricChip value={String(droneHits)} label="DRONE" color={COLORS.teal} />
        <MetricChip value={String(voiceEvents)} label="VOICE" color={COLORS.gold} />
        <MetricChip value={String(voiceAndDrone)} label="BOTH" color={COLORS.warning} />
      </View>

      <Text style={s.hint}>
        "VOICE" = windows the VAD flagged as speech. "BOTH" = a drone call during speech (where the
        confidence gating kicks in). Record voices/crowd with no drone up — DRONE should stay ~0.
      </Text>

      <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 12 }}>
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
            <View style={s.tags}>
              {r.droneDetected ? <Pill label="DRONE" color={COLORS.teal} /> : null}
              {r.voicePresent ? <Pill label="VOICE" color={COLORS.gold} /> : null}
            </View>
          </View>
        ))}
        {rows.length === 0 && (
          <EmptyState icon="database-search" text="No log entries yet. Run monitoring, then refresh." />
        )}
      </ScrollView>

      <View style={s.footer}>
        <PrimaryButton
          label="EXPORT LOG (.db)"
          icon="database-export"
          colors={['#13B6BB', '#0D7E86']}
          onPress={exportDb}
        />
      </View>
      {status ? <Text style={s.status}>{status}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 8, marginTop: 14 },
  hint: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  list: { flex: 1, marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderRadius: RADII.md,
    padding: 10,
    marginBottom: 6,
  },
  rowLabel: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 13, letterSpacing: 0.3 },
  rowConf: { fontFamily: FONTS.mono, color: COLORS.gold, fontSize: 12 },
  rowMeta: { fontFamily: FONTS.monoR, color: COLORS.muted, fontSize: 11, marginTop: 2 },
  tags: { flexDirection: 'row', gap: 6, marginLeft: 6 },
  footer: { flexDirection: 'row', marginTop: 10 },
  status: { fontFamily: FONTS.monoR, color: COLORS.teal, fontSize: 12, marginTop: 8, textAlign: 'center' },
});
