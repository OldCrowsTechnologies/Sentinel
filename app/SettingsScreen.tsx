import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, ScrollView } from 'react-native';
import { COLORS } from '../lib/theme';
import { getRfModuleStatus } from '../lib/rfSensorService';

export interface SettingsState {
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  alertConfidence: number; // %
}

export interface SettingsProps {
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
  onBack: () => void;
}

export default function SettingsScreen({ settings, onChange, onBack }: SettingsProps) {
  const rf = getRfModuleStatus();
  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={s.title}>SETTINGS</Text>

      <View style={s.row}>
        <Text style={s.label}>Corvus voice briefs</Text>
        <Switch value={settings.voiceEnabled} onValueChange={(v) => onChange({ voiceEnabled: v })} />
      </View>
      <Text style={s.hint}>
        Spoken briefs are synthesized securely via Old Crows Wireless — no API key
        is stored on this device. Audible voice activates in production; until then
        briefs deliver as on-screen alerts + haptics.
      </Text>

      <View style={s.row}>
        <Text style={s.label}>Haptic alerts</Text>
        <Switch value={settings.hapticsEnabled} onValueChange={(v) => onChange({ hapticsEnabled: v })} />
      </View>

      <View style={[s.row, { marginTop: 18 }]}>
        <Text style={s.label}>Alert confidence</Text>
        <Text style={s.value}>{settings.alertConfidence}%</Text>
      </View>
      <View style={s.stepRow}>
        <TouchableOpacity style={s.step} onPress={() => onChange({ alertConfidence: Math.max(50, settings.alertConfidence - 5) })}>
          <Text style={s.stepText}>– 5%</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.step} onPress={() => onChange({ alertConfidence: Math.min(99, settings.alertConfidence + 5) })}>
          <Text style={s.stepText}>+ 5%</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.hint}>Minimum classifier confidence to raise a new-threat alert.</Text>

      <View style={[s.row, { marginTop: 18 }]}>
        <Text style={s.label}>External RF sensor (SDR)</Text>
        <Switch value={false} disabled={!rf.present} onValueChange={() => {}} />
      </View>
      <Text style={s.hint}>
        LoRa / ExpressLRS / control-link detection via an external Corvus RF module.
        {' '}
        {rf.note} Antenna inert until a module is connected.
      </Text>

      <View style={s.info}>
        <Text style={s.infoTitle}>MODEL</Text>
        <Text style={s.infoText}>Acoustic MLP, 5-class (None / Skydio X2 / DJI Phantom / Parrot Anafi / Unknown).</Text>
        <Text style={s.infoText}>16 kHz mono · log-mel + band-ratio features · on-device inference.</Text>
        <Text style={s.infoText}>Retrain via training/train_corvus.py with your own recordings.</Text>
      </View>

      <TouchableOpacity style={s.back} onPress={onBack}>
        <Text style={s.backText}>BACK</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1, borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { color: COLORS.lightGray, fontSize: 15 },
  value: { color: COLORS.tealLight, fontSize: 16, fontWeight: '700' },
  hint: { color: COLORS.muted, fontSize: 12, marginBottom: 8 },
  stepRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  step: { flex: 1, borderWidth: 1, borderColor: COLORS.tealDark, borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  stepText: { color: COLORS.tealLight, fontWeight: '700' },
  info: { backgroundColor: COLORS.panel, borderRadius: 8, padding: 14, marginTop: 24 },
  infoTitle: { color: COLORS.gold, fontWeight: '700', fontSize: 12, marginBottom: 8 },
  infoText: { color: COLORS.muted, fontSize: 12, marginBottom: 4 },
  back: { marginTop: 28, backgroundColor: COLORS.tealLight, borderRadius: 6, paddingVertical: 14, alignItems: 'center' },
  backText: { fontWeight: '800', color: COLORS.darkNavy, letterSpacing: 1 },
});
