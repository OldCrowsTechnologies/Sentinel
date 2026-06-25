/**
 * ContactDetailScreen.tsx -- tap a contact to see what to look for.
 *
 * KNOWN library model  -> reference photo (or silhouette placeholder) + specs.
 * UNKNOWN / homemade   -> acoustic "possible spec" (estimates), no photo, with
 *                         a clear "possible homemade / unknown build" call-out.
 */

import React from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../lib/theme';
import type { Threat } from '../lib/threatTracker';
import { getReference, possibleSpec } from '../lib/droneReference';

function fmt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(11, 19) + 'Z';
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
  const band = `~${Math.round(threat.distance * 0.65)}–${Math.round(threat.distance * 1.55)} ft`;
  const gps = threat.lat != null && threat.lon != null
    ? `${threat.lat.toFixed(5)}, ${threat.lon.toFixed(5)}`
    : 'n/a';

  return (
    <View style={s.overlay}>
      <ScrollView contentContainerStyle={s.sheet}>
        <View style={s.headerRow}>
          <Text style={s.title}>{ref ? ref.displayName : 'UNKNOWN BUILD'}</Text>
          <TouchableOpacity onPress={onClose} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {unknown ? (
          <View style={[s.flag, { borderColor: COLORS.warning }]}>
            <Text style={[s.flagText, { color: COLORS.warning }]}>
              POSSIBLE HOMEMADE / CUSTOM — profile not in library
            </Text>
          </View>
        ) : null}

        {/* Image: reference photo when present, else a silhouette placeholder. */}
        <View style={s.imageBox}>
          {ref && ref.image ? (
            <Image source={ref.image} style={s.image} resizeMode="contain" />
          ) : (
            <View style={s.placeholder}>
              <Text style={s.placeholderGlyph}>{unknown ? '⨯' : '🛦'}</Text>
              <Text style={s.placeholderText}>
                {unknown ? 'No reference image — unknown build' : 'Silhouette pending (photo not yet loaded)'}
              </Text>
            </View>
          )}
        </View>

        {/* Spec card */}
        <Text style={s.section}>{unknown ? 'POSSIBLE SPEC (acoustic est.)' : 'REFERENCE SPEC'}</Text>
        {ref ? (
          <View style={s.specs}>
            <Spec k="Type" v={ref.type} />
            <Spec k="Rotors" v={String(ref.rotors)} />
            <Spec k="Size" v={ref.size} />
            <Spec k="Weight" v={ref.weight} />
            <Spec k="Role" v={ref.role} />
          </View>
        ) : (
          <View style={s.specs}>
            {possibleSpec({
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
            ))}
          </View>
        )}

        {/* Live contact data */}
        <Text style={s.section}>CONTACT</Text>
        <View style={s.specs}>
          <Spec k="Confidence" v={`${Math.round(threat.confidence)}%`} />
          <Spec k="Range (est)" v={band} />
          <Spec k="Bearing" v="no bearing (single mic)" />
          <Spec k="Status" v={threat.status} />
          <Spec k="First seen" v={fmt(threat.firstSeen)} />
          <Spec k="Operator GPS" v={gps} />
        </View>

        <TouchableOpacity
          style={[s.btn, { backgroundColor: recorded ? COLORS.tealDark : COLORS.gold }]}
          disabled={recorded}
          onPress={() => {
            onRecord(threat);
            setRecorded(true);
          }}
        >
          <Text style={s.btnText}>{recorded ? 'RECORDED TO LIBRARY ✓' : 'RECORD TO LIBRARY'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={[s.btn, { backgroundColor: COLORS.tealLight, marginTop: 10 }]}>
          <Text style={s.btnText}>CLOSE</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.specRow}>
      <Text style={s.specKey}>{k}</Text>
      <Text style={s.specVal}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0A1422EE', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: COLORS.panel, borderRadius: 12, borderColor: COLORS.tealDark, borderWidth: 1, padding: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.lightGray, fontSize: 20, fontWeight: '800', flex: 1, paddingRight: 8 },
  close: { padding: 6 },
  closeText: { color: COLORS.muted, fontSize: 18, fontWeight: '700' },
  flag: { borderWidth: 1, borderRadius: 6, padding: 8, marginTop: 10, backgroundColor: '#F39C1218' },
  flagText: { fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  imageBox: { height: 170, backgroundColor: COLORS.darkNavy, borderRadius: 8, marginTop: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', padding: 16 },
  placeholderGlyph: { fontSize: 40, color: COLORS.tealDark, marginBottom: 8 },
  placeholderText: { color: COLORS.muted, fontSize: 12, textAlign: 'center' },
  section: { color: COLORS.gold, fontWeight: '700', fontSize: 12, letterSpacing: 1, marginTop: 18, marginBottom: 6 },
  specs: { backgroundColor: COLORS.darkNavy, borderRadius: 8, padding: 12 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  specKey: { color: COLORS.muted, fontSize: 13 },
  specVal: { color: COLORS.lightGray, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right', paddingLeft: 10 },
  specLine: { color: COLORS.lightGray, fontSize: 13, paddingVertical: 3 },
  btn: { backgroundColor: COLORS.tealLight, borderRadius: 6, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  btnText: { color: COLORS.darkNavy, fontWeight: '800', letterSpacing: 1 },
});
