import React from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { AppHeader, Panel, SectionLabel } from './ui';
import { getRfModuleStatus } from '../lib/rfSensorService';

export interface SettingsState {
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  alertConfidence: number; // %
}

export interface SettingsProps {
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
}

function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[s.row, disabled ? { opacity: 0.5 } : null]}>
      <Text style={s.label}>{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: '#1b2c44', true: COLORS.tealDark }}
        thumbColor={COLORS.teal}
        ios_backgroundColor="#1b2c44"
      />
    </View>
  );
}

function Stepper({ icon, onPress }: { icon: 'minus' | 'plus'; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={s.step}>
      <MaterialCommunityIcons name={icon} size={16} color={COLORS.teal} />
      <Text style={s.stepText}>5%</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ settings, onChange }: SettingsProps) {
  const rf = getRfModuleStatus();
  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="SETTINGS" />

      <SectionLabel>ALERTS</SectionLabel>
      <Panel style={s.panel}>
        <SwitchRow
          label="CORVUS VOICE BRIEFS"
          value={settings.voiceEnabled}
          onValueChange={(v) => onChange({ voiceEnabled: v })}
        />
        <Text style={s.hint}>
          Briefs synthesized securely via Old Crows Wireless — no API key on this device. Audible voice
          activates in production; until then briefs deliver as on-screen alerts + haptics.
        </Text>

        <View style={s.divider} />

        <SwitchRow
          label="HAPTIC ALERTS"
          value={settings.hapticsEnabled}
          onValueChange={(v) => onChange({ hapticsEnabled: v })}
        />

        <View style={s.divider} />

        <View style={s.row}>
          <Text style={s.label}>ALERT CONFIDENCE</Text>
          <View style={s.confRight}>
            <Stepper icon="minus" onPress={() => onChange({ alertConfidence: Math.max(50, settings.alertConfidence - 5) })} />
            <Text style={s.value}>{settings.alertConfidence}%</Text>
            <Stepper icon="plus" onPress={() => onChange({ alertConfidence: Math.min(99, settings.alertConfidence + 5) })} />
          </View>
        </View>
        <Text style={s.hint}>Minimum classifier confidence to raise a new-threat alert.</Text>
      </Panel>

      <SectionLabel>SENSORS</SectionLabel>
      <Panel style={s.panel}>
        <SwitchRow
          label="EXTERNAL RF SENSOR (SDR)"
          value={false}
          disabled={!rf.present}
          onValueChange={() => {}}
        />
        <Text style={s.hint}>
          LoRa / ExpressLRS / control-link detection via an external Corvus RF module. {rf.note} Antenna inert
          until a module is connected.
        </Text>
      </Panel>

      <SectionLabel>MODEL</SectionLabel>
      <Panel style={s.panel}>
        <Text style={s.modelText}>Acoustic MLP, 5-class (None / Skydio X2 / DJI Phantom / Parrot Anafi / Unknown).</Text>
        <Text style={s.modelText}>16 kHz mono · log-mel + band-ratio features · on-device inference.</Text>
        <Text style={s.modelText}>Retrain via training/train_corvus.py with your own recordings.</Text>
      </Panel>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  panel: { paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  label: { fontFamily: FONTS.body, color: COLORS.ink, fontSize: 13, letterSpacing: 0.5, flexShrink: 1, paddingRight: 12 },
  value: { fontFamily: FONTS.mono, color: COLORS.teal, fontSize: 15, minWidth: 44, textAlign: 'center' },
  hint: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11.5, lineHeight: 16, paddingBottom: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  confRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: COLORS.teal + '66',
    borderRadius: RADII.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  stepText: { fontFamily: FONTS.displayBold, color: COLORS.teal, fontSize: 11, letterSpacing: 0.5 },
  modelText: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, lineHeight: 17, paddingVertical: 4 },
});
