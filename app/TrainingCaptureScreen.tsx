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
import { COLORS } from '../lib/theme';
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
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} disabled={recording}>
          <Text style={[s.back, recording && { opacity: 0.4 }]}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={s.title}>TRAINING CAPTURE</Text>
        <View style={{ width: 50 }} />
      </View>

      <Text style={s.hint}>
        Record real audio to retrain the model. A few minutes per drone, vary distance + throttle.
        Negatives matter: capture the actual environment quiet + voices/crowd as "None".
      </Text>

      <Text style={s.sectionLabel}>CLASS</Text>
      <View style={s.chips}>
        {PRESET_LABELS.map((l) => (
          <TouchableOpacity
            key={l}
            disabled={recording}
            onPress={() => { setLabel(l); setCustom(''); }}
            style={[s.chip, activeLabel === l && !custom.trim() && s.chipOn]}
          >
            <Text style={[s.chipText, activeLabel === l && !custom.trim() && s.chipTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={s.input}
        editable={!recording}
        placeholder="…or type a new drone type (e.g. Autel EVO II)"
        placeholderTextColor={COLORS.muted}
        value={custom}
        onChangeText={setCustom}
      />

      <TouchableOpacity
        style={[s.record, { backgroundColor: recording ? COLORS.danger : COLORS.tealLight }]}
        onPress={toggle}
      >
        <Text style={s.recordText}>
          {recording ? `STOP  ·  ${dur.toFixed(1)}s` : `RECORD  ·  ${activeLabel}`}
        </Text>
      </TouchableOpacity>
      <Text style={s.status}>{status}</Text>

      <Text style={s.sectionLabel}>CAPTURED CLIPS ({clips.length})</Text>
      <ScrollView style={s.list}>
        {clips.map((c) => (
          <View key={c.id} style={s.item}>
            <View style={{ flex: 1 }}>
              <Text style={s.itemLabel}>{c.label}</Text>
              <Text style={s.itemMeta}>{c.durationSec.toFixed(1)}s · {new Date(c.timestamp).toLocaleTimeString()}</Text>
            </View>
            <TouchableOpacity style={s.itemBtn} onPress={() => exportClip(c.id)}>
              <Text style={s.itemBtnText}>SHARE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.itemBtn} onPress={() => deleteClip(c.id).then(refresh)}>
              <Text style={[s.itemBtnText, { color: COLORS.danger }]}>DEL</Text>
            </TouchableOpacity>
          </View>
        ))}
        {clips.length === 0 && <Text style={s.empty}>No clips yet.</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.darkNavy, padding: 16, paddingTop: 56 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: COLORS.gold, borderBottomWidth: 2, paddingBottom: 10 },
  back: { color: COLORS.tealLight, fontWeight: '700', fontSize: 13 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.lightGray, letterSpacing: 1 },
  hint: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  sectionLabel: { color: COLORS.gold, fontWeight: '700', fontSize: 12, letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.tealDark, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: COLORS.tealLight, borderColor: COLORS.tealLight },
  chipText: { color: COLORS.tealLight, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: COLORS.darkNavy },
  input: { borderWidth: 1, borderColor: COLORS.tealDark, borderRadius: 8, color: COLORS.lightGray, padding: 10, marginTop: 10, fontSize: 13 },
  record: { borderRadius: 8, paddingVertical: 18, alignItems: 'center', marginTop: 18 },
  recordText: { color: COLORS.darkNavy, fontWeight: '800', letterSpacing: 1, fontSize: 15 },
  status: { color: COLORS.tealLight, fontSize: 12, marginTop: 10 },
  list: { flex: 1, marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panel, borderRadius: 6, padding: 12, marginBottom: 8 },
  itemLabel: { color: COLORS.lightGray, fontWeight: '700', fontSize: 14 },
  itemMeta: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  itemBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  itemBtnText: { color: COLORS.tealLight, fontWeight: '700', fontSize: 12 },
  empty: { color: COLORS.muted, textAlign: 'center', paddingVertical: 20 },
});
