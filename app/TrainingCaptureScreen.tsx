/**
 * TrainingCaptureScreen.tsx -- one-tap labeled data collection. Pick a class,
 * record a clip, it's saved as a .wav (auto-labeling filename) and can be
 * shared off the device into data/recordings/<class>/ for retraining.
 *
 * Live monitoring must be stopped first (single mic session) -- App handles that
 * when this screen opens.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { AppHeader, SectionLabel, PrimaryButton, EmptyState } from './ui';
import TrainingCapture from '../lib/trainingCapture';
import { saveClip, listClips, deleteClip, exportClip, TrainingClipMeta } from '../lib/trainingStore';

const PRESET_LABELS = ['None', 'Skydio X2', 'DJI Phantom', 'Parrot Anafi', 'Unknown'];

export default function TrainingCaptureScreen({ onBack }: { onBack: () => void }) {
  const capRef = useRef<TrainingCapture | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [label, setLabel] = useState('Skydio X2');
  const [custom, setCustom] = useState('');
  const [recording, setRecording] = useState(false);
  const [dur, setDur] = useState(0);
  const [clips, setClips] = useState<TrainingClipMeta[]>([]);
  const [status, setStatus] = useState('Pick a class, then RECORD.');

  const refresh = useCallback(() => listClips().then(setClips).catch(() => {}), []);
  useEffect(() => {
    refresh();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      capRef.current?.stop().catch(() => {});
    };
  }, [refresh]);

  const activeLabel = custom.trim() ? custom.trim() : label;

  const toggle = async () => {
    if (recording) {
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      const cap = capRef.current;
      if (!cap) return;
      const { samples, sampleRate } = await cap.stop();
      if (samples.length < sampleRate) {
        setStatus('Clip too short — hold RECORD longer.');
        return;
      }
      try {
        const meta = await saveClip(activeLabel, samples, sampleRate);
        setStatus(`Saved ${meta.durationSec.toFixed(1)}s as "${meta.label}".`);
        refresh();
      } catch (e) {
        setStatus('Save failed: ' + String(e));
      }
    } else {
      try {
        capRef.current = new TrainingCapture();
        await capRef.current.start();
        setRecording(true);
        setDur(0);
        setStatus(`Recording "${activeLabel}"…`);
        timerRef.current = setInterval(() => setDur(capRef.current?.durationSec() ?? 0), 250);
      } catch (e) {
        setStatus('Cannot record: ' + String(e));
      }
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="TRAINING CAPTURE" onBack={onBack} />

      <Text style={s.hint}>
        Record real audio to retrain the model. A few minutes per drone, vary distance + throttle.
        Negatives matter: capture the actual environment quiet + voices/crowd as "None".
      </Text>

      <SectionLabel>CLASS</SectionLabel>
      <View style={s.chips}>
        {PRESET_LABELS.map((l) => {
          const on = activeLabel === l && !custom.trim();
          return (
            <TouchableOpacity
              key={l}
              disabled={recording}
              onPress={() => { setLabel(l); setCustom(''); }}
              style={[s.chip, on && s.chipOn]}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{l.toUpperCase()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={s.input}
        editable={!recording}
        placeholder="…or type a new drone type (e.g. Autel EVO II)"
        placeholderTextColor={COLORS.muted}
        value={custom}
        onChangeText={setCustom}
      />

      <View style={s.recordRow}>
        <PrimaryButton
          label={recording ? `STOP · ${dur.toFixed(1)}s` : `RECORD · ${activeLabel.toUpperCase()}`}
          icon={recording ? 'stop' : 'microphone'}
          colors={recording ? ['#FF5A5F', '#E0353B'] : ['#13B6BB', '#0D7E86']}
          glow={recording ? '#FF5A5F' : COLORS.teal}
          onPress={toggle}
        />
      </View>
      <Text style={s.status}>{status}</Text>

      <SectionLabel>{`CAPTURED CLIPS (${clips.length})`}</SectionLabel>
      <ScrollView style={s.list} contentContainerStyle={clips.length === 0 && { flexGrow: 1 }}>
        {clips.map((c) => (
          <View key={c.id} style={s.item}>
            <View style={{ flex: 1 }}>
              <Text style={s.itemLabel}>{c.label.toUpperCase()}</Text>
              <Text style={s.itemMeta}>{c.durationSec.toFixed(1)}s · {new Date(c.timestamp).toLocaleTimeString()}</Text>
            </View>
            <TouchableOpacity style={s.itemBtn} onPress={() => exportClip(c.id)} activeOpacity={0.7}>
              <Text style={s.itemBtnText}>SHARE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.itemBtn} onPress={() => deleteClip(c.id).then(refresh)} activeOpacity={0.7}>
              <Text style={[s.itemBtnText, { color: COLORS.danger }]}>DEL</Text>
            </TouchableOpacity>
          </View>
        ))}
        {clips.length === 0 && <EmptyState icon="microphone-off" text="No clips captured yet." />}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.tealDark, borderRadius: RADII.pill, paddingHorizontal: 13, paddingVertical: 7 },
  chipOn: { backgroundColor: COLORS.teal, borderColor: COLORS.teal },
  chipText: { fontFamily: FONTS.display, color: COLORS.teal, fontSize: 12, letterSpacing: 0.8 },
  chipTextOn: { color: COLORS.bg },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderRadius: RADII.sm,
    color: COLORS.ink,
    fontFamily: FONTS.body,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
    fontSize: 13,
  },
  recordRow: { flexDirection: 'row', marginTop: 18 },
  status: { fontFamily: FONTS.body, color: COLORS.teal, fontSize: 12, marginTop: 10 },
  list: { flex: 1, marginTop: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderRadius: RADII.md,
    padding: 12,
    marginBottom: 8,
  },
  itemLabel: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 14, letterSpacing: 0.5 },
  itemMeta: { fontFamily: FONTS.monoR, color: COLORS.muted, fontSize: 11, marginTop: 3 },
  itemBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  itemBtnText: { fontFamily: FONTS.displayBold, color: COLORS.teal, fontSize: 12, letterSpacing: 0.8 },
});
