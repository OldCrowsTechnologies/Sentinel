import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../lib/theme';
import type { Threat } from '../lib/threatTracker';

export interface DetectionsProps {
  log: Threat[];
  onBack: () => void;
}

const t = (ts: number) => new Date(ts).toLocaleTimeString();

export default function DetectionsScreen({ log, onBack }: DetectionsProps) {
  return (
    <View style={s.container}>
      <Text style={s.title}>SESSION LOG</Text>
      {log.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>No contacts logged this session.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {log
            .slice()
            .reverse()
            .map((d) => (
              <View key={d.id} style={s.item}>
                <View style={s.row}>
                  <Text style={s.type}>{d.type}</Text>
                  <Text style={s.conf}>{Math.round(d.confidence)}%</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.detail}>closest ~{Math.round(d.distance)} ft</Text>
                  <Text style={s.detail}>{d.trajectory.length} hits</Text>
                </View>
                <Text style={s.time}>
                  {t(d.firstSeen)} → {t(d.lastSeen)}
                </Text>
              </View>
            ))}
        </ScrollView>
      )}
      <TouchableOpacity style={s.back} onPress={onBack}>
        <Text style={s.backText}>BACK</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1, borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10, marginBottom: 16 },
  item: { backgroundColor: COLORS.panel, borderRadius: 6, padding: 12, marginBottom: 8, borderLeftColor: COLORS.tealDark, borderLeftWidth: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  type: { color: COLORS.lightGray, fontWeight: '700', fontSize: 15 },
  conf: { color: COLORS.gold, fontWeight: '700' },
  detail: { color: COLORS.muted, fontSize: 12 },
  time: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: COLORS.muted },
  back: { marginTop: 12, backgroundColor: COLORS.tealLight, borderRadius: 6, paddingVertical: 14, alignItems: 'center' },
  backText: { fontWeight: '800', color: COLORS.darkNavy, letterSpacing: 1 },
});
