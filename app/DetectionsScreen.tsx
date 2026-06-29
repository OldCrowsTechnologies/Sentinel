import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADII, sevColor } from '../lib/theme';
import { AppHeader, EmptyState } from './ui';
import { getReference, faaClassInfo, faaClassFromSizeClass } from '../lib/droneReference';
import type { Threat } from '../lib/threatTracker';

export interface DetectionsProps {
  log: Threat[];
  onBack: () => void;
}

const t = (ts: number) => new Date(ts).toLocaleTimeString();

export default function DetectionsScreen({ log, onBack }: DetectionsProps) {
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="SESSION LOG" onBack={onBack} />
      {log.length === 0 ? (
        <EmptyState icon="format-list-bulleted" text="No contacts logged this session." />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}>
          {log
            .slice()
            .reverse()
            .map((d) => {
              const accent = sevColor(d.distance);
              const ref = getReference(d.type);
              const faa = faaClassInfo(ref ? ref.faaClass : faaClassFromSizeClass(d.sizeClass ?? null));
              const name = ref ? ref.displayName : d.isUnknownBuild ? 'Unknown / homemade build' : d.type;
              return (
                <View key={d.id} style={[s.card, { borderLeftColor: accent }]}>
                  <View style={s.row}>
                    <Text style={s.type}>{name}</Text>
                    <Text style={s.conf}>{Math.round(d.confidence)}%</Text>
                  </View>
                  <Text style={s.faaLine}>
                    {faa.label} · {faa.bracket}
                  </Text>
                  <Text style={s.detail}>
                    closest ~{Math.round(d.distance)}ft · {d.trajectory.length} hits
                  </Text>
                  <Text style={s.time}>
                    {t(d.firstSeen)} → {t(d.lastSeen)}
                  </Text>
                </View>
              );
            })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: COLORS.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderRadius: RADII.md,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 15, letterSpacing: 0.5 },
  conf: { fontFamily: FONTS.mono, color: COLORS.gold, fontSize: 13 },
  faaLine: { fontFamily: FONTS.display, color: COLORS.teal, fontSize: 10, letterSpacing: 0.8, marginTop: 3 },
  detail: { fontFamily: FONTS.monoR, color: COLORS.muted, fontSize: 12, marginTop: 4 },
  time: { fontFamily: FONTS.monoR, color: COLORS.faint, fontSize: 11, marginTop: 3 },
});
