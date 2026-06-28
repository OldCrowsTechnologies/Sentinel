/**
 * ContactDetailScreen.tsx -- tap a contact to see what to look for.
 *
 * KNOWN library model  -> reference photo (or silhouette placeholder) + specs.
 * UNKNOWN / homemade   -> acoustic "possible spec" (estimates), no photo, with
 *                         a clear "possible homemade / unknown build" call-out.
 */

import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, RADII, sevColor, rangeBand } from '../lib/theme';
import { SectionLabel, KV, Pill, PrimaryButton, IconButton } from './ui';
import type { Threat } from '../lib/threatTracker';
import { getReference, possibleSpec } from '../lib/droneReference';

function fmt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(11, 19) + 'Z';
}

// ---- confidence donut ring ----
function ConfidenceRing({ confidence }: { confidence: number }) {
  const size = 58;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, confidence));
  const dash = (pct / 100) * c;

  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="#16263c" strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={COLORS.teal}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <SvgText
        x={size / 2}
        y={size / 2 + 5}
        fill={COLORS.ink}
        fontSize={16}
        fontFamily={FONTS.mono}
        textAnchor="middle"
      >
        {`${Math.round(pct)}%`}
      </SvgText>
    </Svg>
  );
}

export default function ContactDetailScreen({
  threat,
  onClose,
  onRecord,
}: {
  threat: Threat;
  onClose: () => void;
  onRecord: (t: Threat) => void;
}) {
  const [recorded, setRecorded] = React.useState(false);
  const ref = getReference(threat.type);
  const unknown = !ref; // no library entry => treat as unknown/homemade build
  const gps =
    threat.lat != null && threat.lon != null
      ? `${threat.lat.toFixed(5)}, ${threat.lon.toFixed(5)}`
      : 'n/a';
  const bearing =
    threat.bearing >= 0 ? `${Math.round(threat.bearing)}°` : 'no bearing (single mic)';
  const statusColor = threat.isUnknownBuild ? COLORS.warning : sevColor(threat.distance);

  return (
    <View style={s.overlay}>
      <View style={s.sheet}>
        <View style={s.headerRow}>
          <Text style={s.title}>{ref ? ref.displayName : 'UNKNOWN BUILD'}</Text>
          <IconButton icon="close" color={COLORS.muted} onPress={onClose} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {unknown ? (
            <View style={s.flag}>
              <MaterialCommunityIcons name="alert-rhombus-outline" size={16} color={COLORS.warning} />
              <Text style={s.flagText}>POSSIBLE HOMEMADE / CUSTOM — profile not in library</Text>
            </View>
          ) : null}

          {/* Image: reference photo when present, else a placeholder glyph. */}
          <View style={s.imageBox}>
            {ref && ref.image ? (
              <Image source={ref.image} style={s.image} resizeMode="contain" />
            ) : (
              <View style={s.placeholder}>
                <MaterialCommunityIcons
                  name={unknown ? 'help-rhombus-outline' : 'quadcopter'}
                  size={46}
                  color={COLORS.faint}
                />
                <Text style={s.placeholderText}>
                  {unknown
                    ? 'No reference image — unknown build'
                    : 'Silhouette pending (photo not yet loaded)'}
                </Text>
              </View>
            )}
          </View>

          {/* Confidence ring + status posture */}
          <View style={s.ringRow}>
            <ConfidenceRing confidence={threat.confidence} />
            <View style={s.ringMeta}>
              <Text style={s.ringLabel}>CONFIDENCE</Text>
              <Pill label={threat.status.toUpperCase()} color={statusColor} dot />
            </View>
          </View>

          {/* Spec card */}
          <SectionLabel>{unknown ? 'POSSIBLE SPEC (ACOUSTIC EST.)' : 'REFERENCE SPEC'}</SectionLabel>
          <View style={s.specBox}>
            {ref ? (
              <>
                <KV k="Type" v={ref.type} />
                <KV k="Rotors" v={String(ref.rotors)} />
                <KV k="Size" v={ref.size} />
                <KV k="Weight" v={ref.weight} />
                <KV k="Role" v={ref.role} />
              </>
            ) : (
              possibleSpec({
                dronePresent: true,
                droneness: 1,
                isUnknownBuild: true,
                matchedModel: null,
                oodScore: threat.oodScore ?? 0,
                category: 'electric-multirotor',
                estFundamentalHz: threat.estFundamentalHz ?? null,
                sizeClass: threat.sizeClass ?? null,
              }).map((line, i) => (
                <Text key={i} style={s.specLine}>
                  • {line}
                </Text>
              ))
            )}
          </View>

          {/* Live contact data */}
          <SectionLabel>CONTACT</SectionLabel>
          <View style={s.specBox}>
            <KV k="Confidence" v={`${Math.round(threat.confidence)}%`} />
            <KV k="Range (est)" v={rangeBand(threat.distance)} />
            <KV k="Bearing" v={bearing} />
            <KV k="Status" v={threat.status} />
            <KV k="First seen" v={fmt(threat.firstSeen)} />
            <KV k="Operator GPS" v={gps} vColor={COLORS.gold} />
          </View>

          <View style={s.actions}>
            <PrimaryButton
              label={recorded ? 'RECORDED ✓' : 'RECORD TO LIBRARY'}
              icon="bookmark-plus"
              colors={recorded ? ['#2A3D57', '#1B2C44'] : ['#D9B24A', '#B8922A']}
              disabled={recorded}
              onPress={() => {
                onRecord(threat);
                setRecorded(true);
              }}
            />
          </View>
          <View style={s.actions}>
            <PrimaryButton label="CLOSE" colors={['#13B6BB', '#0D7E86']} onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,11,20,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: COLORS.panel,
    borderRadius: 16,
    borderColor: COLORS.panelBorder,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  scroll: { paddingBottom: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 19, letterSpacing: 1, flex: 1, paddingRight: 8 },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.warning,
    borderRadius: RADII.sm,
    padding: 10,
    marginTop: 8,
    backgroundColor: COLORS.warning + '14',
  },
  flagText: { fontFamily: FONTS.displayBold, color: COLORS.warning, fontSize: 11, letterSpacing: 0.6, flex: 1 },
  imageBox: {
    height: 150,
    backgroundColor: COLORS.panelAlt,
    borderRadius: RADII.md,
    marginTop: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', padding: 16 },
  placeholderText: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, textAlign: 'center', marginTop: 8 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  ringMeta: { gap: 6 },
  ringLabel: { fontFamily: FONTS.display, color: COLORS.muted, fontSize: 9.5, letterSpacing: 2 },
  specBox: { backgroundColor: COLORS.panelAlt, borderRadius: RADII.sm, paddingVertical: 4, paddingHorizontal: 0 },
  specLine: { fontFamily: FONTS.body, color: COLORS.ink, fontSize: 13, paddingVertical: 3, paddingHorizontal: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', marginTop: 12 },
});
