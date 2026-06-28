/**
 * LibraryScreen.tsx -- hub for the data-side screens (session log, mission
 * analysis, training capture) plus the specimen-library status.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { AppHeader } from './ui';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export default function LibraryScreen({
  specimenCount,
  sessionCount,
  onOpen,
}: {
  specimenCount: number;
  sessionCount: number;
  onOpen: (s: 'detections' | 'analysis' | 'training') => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="LIBRARY" />
      <View style={{ marginTop: 14 }}>
        <Row icon="format-list-bulleted" tint={COLORS.teal} title="Session log" sub={`${sessionCount} contact${sessionCount === 1 ? '' : 's'} this session`} onPress={() => onOpen('detections')} />
        <Row icon="chart-timeline-variant" tint={COLORS.gold} title="Mission analysis" sub="detection log · export .db" onPress={() => onOpen('analysis')} />
        <Row icon="microphone-plus" tint={COLORS.ok} title="Training capture" sub="record labeled clips to retrain" onPress={() => onOpen('training')} />
      </View>

      <View style={st.specimen}>
        <MaterialCommunityIcons name="dna" size={22} color={COLORS.gold} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={st.specTitle}>Specimen library</Text>
          <Text style={st.specSub}>{specimenCount} unknown-build capture{specimenCount === 1 ? '' : 's'} pending sync</Text>
        </View>
        <Text style={st.specCount}>{specimenCount}</Text>
      </View>
    </View>
  );
}

function Row({ icon, tint, title, sub, onPress }: { icon: IconName; tint: string; title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={st.row} onPress={onPress} activeOpacity={0.75}>
      <View style={[st.iconWrap, { borderColor: tint + '66' }]}>
        <MaterialCommunityIcons name={icon} size={22} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.title}>{title}</Text>
        <Text style={st.sub}>{sub}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.muted} />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.panelBorder, borderRadius: RADII.md, padding: 13, marginBottom: 10 },
  iconWrap: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, backgroundColor: COLORS.panelAlt, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  title: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 15, letterSpacing: 0.4 },
  sub: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, marginTop: 1 },
  specimen: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panelAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.panelBorder, borderRadius: RADII.md, padding: 14, marginTop: 6 },
  specTitle: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 14 },
  specSub: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11.5, marginTop: 1 },
  specCount: { fontFamily: FONTS.mono, color: COLORS.gold, fontSize: 24, fontWeight: '700' },
});
