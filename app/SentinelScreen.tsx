import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, sevColor, rangeBand } from '../lib/theme';
import { AppHeader, Pill, MetricChip, PrimaryButton, IconButton, EmptyState } from './ui';
import RadarScope, { ScopeContact } from './RadarScope';
import { getReference, faaClassInfo, faaClassFromSizeClass } from '../lib/droneReference';
import type { Threat, AlertEvent } from '../lib/threatTracker';

export interface SentinelProps {
  isMonitoring: boolean;
  modelReady: boolean;
  statusText: string;
  level: number;
  peakLevel: number;
  onResetPeak: () => void;
  specimenCount: number;
  threats: Threat[];
  lastAlert: AlertEvent | null;
  onToggle: () => void;
  onReport: () => void;
  onSelectThreat: (threat: Threat) => void;
}

export default function SentinelScreen(props: SentinelProps) {
  const { isMonitoring, modelReady, statusText, level, peakLevel, specimenCount, threats, lastAlert } = props;

  const nearest = threats.length ? Math.min(...threats.map((t) => t.distance)) : 0;
  const topConf = threats.length ? Math.max(...threats.map((t) => t.confidence)) : 0;
  const maxRange = Math.max(600, ...threats.map((t) => t.distance * 1.2));

  let posture = { label: 'IDLE', color: COLORS.muted };
  if (isMonitoring) {
    if (threats.some((t) => t.distance < 150)) posture = { label: 'THREAT', color: COLORS.danger };
    else if (threats.length) posture = { label: 'CONTACT', color: COLORS.warning };
    else posture = { label: 'SCANNING', color: COLORS.teal };
  }

  const scopeContacts: ScopeContact[] = threats.map((t) => ({
    id: t.id,
    distance: t.distance,
    bearing: t.bearing,
    isUnknownBuild: !!t.isUnknownBuild,
  }));

  return (
    <View style={s.fill}>
      <AppHeader title="CORVUS" accent="SENTINEL" brand right={<Pill label={posture.label} color={posture.color} dot />} />

      <Text style={s.status} numberOfLines={1}>
        {statusText}
      </Text>

      <View style={s.scopeWrap}>
        <RadarScope active={isMonitoring} contacts={scopeContacts} maxRangeFt={maxRange} size={236} />
        {isMonitoring && (
          <View style={s.locateRow}>
            <Text style={s.locate}>◎ rotate to peak · signal {Math.round(level * 100)}%</Text>
            <TouchableOpacity onPress={props.onResetPeak} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.reset}>peak {Math.round(peakLevel * 100)}% · reset</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={s.chips}>
        <MetricChip value={String(threats.length)} label="CONTACTS" />
        <View style={{ width: 8 }} />
        <MetricChip value={threats.length ? `${Math.round(topConf)}%` : '—'} label="TOP CONF" color={COLORS.teal} />
        <View style={{ width: 8 }} />
        <MetricChip value={threats.length ? String(Math.round(nearest)) : '—'} label="NEAREST FT" color={threats.length ? sevColor(nearest) : COLORS.ink} />
      </View>

      {lastAlert && (
        <View style={s.alert}>
          <MaterialCommunityIcons name="alert" size={14} color={COLORS.danger} />
          <Text style={s.alertText} numberOfLines={2}>
            {lastAlert.message}
          </Text>
        </View>
      )}

      {threats.length > 0 ? (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {threats.map((t) => (
            <ContactRow key={t.id} t={t} onPress={() => props.onSelectThreat(t)} />
          ))}
        </ScrollView>
      ) : (
        <EmptyState
          icon={isMonitoring ? 'radar' : 'power'}
          text={isMonitoring ? 'Listening — no airborne contacts.' : 'Press START to begin monitoring.'}
        />
      )}

      {specimenCount > 0 && (
        <Text style={s.specimens}>
          <MaterialCommunityIcons name="dna" size={11} color={COLORS.gold} /> specimen library · {specimenCount} unknown-build capture{specimenCount === 1 ? '' : 's'}
        </Text>
      )}

      <View style={s.controls}>
        <PrimaryButton
          label={isMonitoring ? 'STOP' : 'START'}
          icon={isMonitoring ? 'stop' : 'play'}
          colors={isMonitoring ? ['#FF5A5F', '#E0353B'] : ['#13B6BB', '#0D7E86']}
          glow={isMonitoring ? COLORS.danger : COLORS.teal}
          disabled={!modelReady}
          onPress={props.onToggle}
        />
        <View style={{ width: 12 }} />
        <IconButton icon="file-document-outline" onPress={props.onReport} />
      </View>
    </View>
  );
}

function ContactRow({ t, onPress }: { t: Threat; onPress: () => void }) {
  const col = t.isUnknownBuild ? COLORS.warning : sevColor(t.distance);
  const conf = Math.round(t.confidence);
  const ref = getReference(t.type);
  const faa = faaClassInfo(ref ? ref.faaClass : faaClassFromSizeClass(t.sizeClass ?? null));
  const name = ref ? ref.displayName : t.isUnknownBuild ? 'Unknown / homemade build' : t.type;
  return (
    <TouchableOpacity style={[s.card, { borderLeftColor: col }]} onPress={onPress} activeOpacity={0.75}>
      <View style={s.cardRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
          <MaterialCommunityIcons name={t.isUnknownBuild ? 'alert-rhombus' : 'quadcopter'} size={17} color={t.isUnknownBuild ? COLORS.warning : '#AEB9C8'} />
          <Text style={s.cardType} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={s.cardConf}>{conf}%</Text>
      </View>
      <Text style={s.faaLine} numberOfLines={1}>
        {faa.label} · {faa.bracket}
      </Text>
      <View style={s.bar}>
        <View style={[s.barFill, { width: `${conf}%`, backgroundColor: col }]} />
      </View>
      <View style={s.cardRow}>
        <Text style={s.detail}>
          {rangeBand(t.distance)} · {t.bearing >= 0 ? `${Math.round(t.bearing)}°` : 'no bearing'}
        </Text>
        <Pill label={t.status.toUpperCase()} color={col} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  status: { fontFamily: FONTS.monoR, color: COLORS.muted, fontSize: 11, marginTop: 9 },
  scopeWrap: { alignItems: 'center', marginTop: 4 },
  locateRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: -6, marginBottom: 2, paddingHorizontal: 4 },
  locate: { fontFamily: FONTS.display, color: COLORS.muted, fontSize: 10, letterSpacing: 0.5 },
  reset: { fontFamily: FONTS.display, color: COLORS.gold, fontSize: 10, letterSpacing: 0.5 },
  chips: { flexDirection: 'row', marginTop: 8 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FF4D5218', borderColor: COLORS.danger + '66', borderWidth: StyleSheet.hairlineWidth, borderRadius: RADII.sm, padding: 8, marginTop: 10 },
  alertText: { fontFamily: FONTS.body, color: COLORS.ink, fontSize: 12, flex: 1 },
  list: { flex: 1, marginTop: 10 },
  card: { backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.panelBorder, borderLeftWidth: 3, borderRadius: RADII.sm, padding: 10, marginBottom: 8 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardType: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 14, letterSpacing: 0.3 },
  cardConf: { fontFamily: FONTS.mono, color: COLORS.gold, fontSize: 13, fontWeight: '700' },
  faaLine: { fontFamily: FONTS.display, color: COLORS.teal, fontSize: 9.5, letterSpacing: 0.8, marginTop: 4 },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#0D1726', overflow: 'hidden', marginVertical: 7 },
  barFill: { height: 5, borderRadius: 3 },
  detail: { fontFamily: FONTS.monoR, color: COLORS.muted, fontSize: 10.5 },
  specimens: { fontFamily: FONTS.body, color: COLORS.gold, fontSize: 11, marginTop: 8, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6 },
});
