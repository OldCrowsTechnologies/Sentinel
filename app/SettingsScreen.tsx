import React, { useEffect, useState } from 'react';
import {
  View, Text, Switch, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { AppHeader, Panel, SectionLabel } from './ui';
import { getRfModuleStatus } from '../lib/rfSensorService';
import { enrollWithCode, getEnrollment, signOutCloud } from '../lib/cloudSync';

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

function CommandLinkPanel() {
  const [info, setInfo] = useState(getEnrollment());
  const [code, setCode] = useState('');
  const [callsign, setCallsign] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setInfo(getEnrollment()); }, []);

  if (!info.configured) {
    return (
      <Panel style={s.panel}>
        <Text style={s.hint}>C2 command link is not enabled in this build.</Text>
      </Panel>
    );
  }

  const doEnroll = async () => {
    if (!code.trim()) { Alert.alert('Enter your unit code', 'Ask command for the seat code.'); return; }
    setBusy(true);
    try {
      const r = await enrollWithCode(code, callsign);
      setInfo(getEnrollment());
      setCode(''); setCallsign('');
      Alert.alert('Linked to command', `${r.orgName ?? 'Agency'}${r.callSign ? ' · ' + r.callSign : ''}`);
    } catch (e: any) {
      Alert.alert('Link failed', e?.message ?? 'Could not link to command.');
    } finally { setBusy(false); }
  };

  const doSignOut = async () => {
    setBusy(true);
    try { await signOutCloud(); setInfo(getEnrollment()); } finally { setBusy(false); }
  };

  if (info.enrolled) {
    return (
      <Panel style={s.panel}>
        <View style={s.row}>
          <Text style={s.label}>STATUS</Text>
          <View style={s.linkRight}><View style={s.liveDot} /><Text style={s.value}>LINKED</Text></View>
        </View>
        <View style={s.divider} />
        <View style={s.row}><Text style={s.label}>AGENCY</Text><Text style={s.metaVal}>{info.orgName ?? '—'}</Text></View>
        <View style={s.divider} />
        <View style={s.row}><Text style={s.label}>CALL SIGN</Text><Text style={s.metaVal}>{info.callSign ?? '—'}</Text></View>
        <Text style={s.hint}>Positions + detections stream to the C2 command dashboard in real time.</Text>
        <TouchableOpacity style={s.btnGhost} onPress={doSignOut} disabled={busy} activeOpacity={0.8}>
          <Text style={s.btnGhostText}>{busy ? '…' : 'UNLINK'}</Text>
        </TouchableOpacity>
      </Panel>
    );
  }

  return (
    <Panel style={s.panel}>
      <Text style={s.fieldLabel}>UNIT CODE</Text>
      <TextInput
        value={code} onChangeText={setCode}
        placeholder="ECSO-BA-DEPUTY" placeholderTextColor={COLORS.muted}
        autoCapitalize="characters" autoCorrect={false} style={s.input}
      />
      <Text style={s.fieldLabel}>CALL SIGN</Text>
      <TextInput
        value={callsign} onChangeText={setCallsign}
        placeholder="ADAM-12" placeholderTextColor={COLORS.muted}
        autoCorrect={false} style={s.input}
      />
      <TouchableOpacity style={s.btn} onPress={doEnroll} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#04201d" /> : <Text style={s.btnText}>LINK TO COMMAND</Text>}
      </TouchableOpacity>
      <Text style={s.hint}>Enter the code from command and a call sign so C2 can identify this unit on the map.</Text>
    </Panel>
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

      <SectionLabel>COMMAND LINK (C2)</SectionLabel>
      <CommandLinkPanel />

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
        <Text style={s.modelText}>Acoustic MLP, 17-class taxonomy — fixed-wing UAS, multirotor size classes, FPV, combustion, named models, plus non-threat call-outs (bird / manned aircraft).</Text>
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
  // Command link (C2)
  metaVal: { fontFamily: FONTS.mono, color: COLORS.ink, fontSize: 13 },
  linkRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.teal },
  fieldLabel: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11, letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  input: {
    fontFamily: FONTS.mono, color: COLORS.ink, fontSize: 15, letterSpacing: 1,
    backgroundColor: '#0c1622', borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: RADII.sm, paddingHorizontal: 12, paddingVertical: 10,
  },
  btn: {
    marginTop: 16, backgroundColor: COLORS.teal, borderRadius: RADII.sm,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { fontFamily: FONTS.displayBold, color: '#04201d', fontSize: 14, letterSpacing: 1 },
  btnGhost: {
    marginTop: 14, borderWidth: 1, borderColor: COLORS.teal + '66', borderRadius: RADII.sm,
    paddingVertical: 10, alignItems: 'center',
  },
  btnGhostText: { fontFamily: FONTS.displayBold, color: COLORS.teal, fontSize: 12, letterSpacing: 1 },
});
