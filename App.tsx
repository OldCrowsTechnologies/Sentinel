import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Share, StatusBar, View } from 'react-native';

import SentinelScreen from './app/SentinelScreen';
import SettingsScreen, { SettingsState } from './app/SettingsScreen';
import DetectionsScreen from './app/DetectionsScreen';

import AudioCaptureService from './lib/audioCapture';
import DroneClassifier, { CorvusModel } from './lib/mlClassifier';
import ThreatTracker, { Threat, AlertEvent } from './lib/threatTracker';
import CorvusVoice from './lib/corvusVoice';
import { writeReport } from './lib/reportGenerator';
import corvusModelJson from './assets/models/corvus-model.json';

type ScreenName = 'sentinel' | 'settings' | 'detections';

const API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
const SILENCE_RMS = 0.004; // below this, treat window as silence (force "None")

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('sentinel');
  const [isMonitoring, setMonitoring] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [statusText, setStatus] = useState('Initializing…');
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0); // peak-hold for the rotate-to-peak locate aid
  const [threats, setThreats] = useState<Threat[]>([]);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    voiceEnabled: true,
    hapticsEnabled: true,
    alertConfidence: 85,
    hasApiKey: API_KEY.length > 0,
  });

  const audioRef = useRef<AudioCaptureService | null>(null);
  const clfRef = useRef<DroneClassifier | null>(null);
  const trackerRef = useRef<ThreatTracker | null>(null);
  const voiceRef = useRef<CorvusVoice | null>(null);
  const sessionStartRef = useRef<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    try {
      const clf = new DroneClassifier(corvusModelJson as unknown as CorvusModel);
      clfRef.current = clf;
      trackerRef.current = new ThreatTracker();
      trackerRef.current.setThresholds({ minConfidence: settings.alertConfidence });
      voiceRef.current = new CorvusVoice(API_KEY);
      audioRef.current = new AudioCaptureService({
        sampleRate: corvusModelJson.dsp.sampleRate,
        windowSec: corvusModelJson.dsp.clipSec,
        hopSec: 1.0,
      });
      setModelReady(clf.ready());
      setStatus(clf.ready() ? 'Ready. Model loaded.' : 'Model failed to load.');
    } catch (e) {
      setStatus('Init error: ' + String(e));
    }
    return () => {
      audioRef.current?.stopMonitoring();
      voiceRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindow = useCallback((win: Float32Array, rms: number) => {
    const clf = clfRef.current;
    const tracker = trackerRef.current;
    if (!clf || !tracker) return;

    const lvl = Math.min(1, rms * 12);
    setLevel(lvl);
    setPeakLevel((p) => Math.max(p, lvl)); // hold the loudest reading for rotate-to-peak

    const result = clf.classifySamples(win);
    const label = rms < SILENCE_RMS ? 'None' : result.label;

    const alerts = tracker.update({
      label,
      confidence: result.confidence,
      distance: result.distance,
      bearing: result.bearing,
      timestamp: Date.now(),
    });

    setThreats(tracker.getActiveThreats());

    if (alerts.length > 0) {
      const newOrApproach = alerts.find((a) => a.type === 'new_threat' || a.type === 'approaching');
      if (newOrApproach) {
        setLastAlert(newOrApproach);
        const active = tracker.getActiveThreats();
        voiceRef.current?.brief(
          active.map((t) => ({ type: t.type, distance: `${Math.round(t.distance)} ft` })),
          { speak: settingsRef.current.voiceEnabled, vibrate: settingsRef.current.hapticsEnabled }
        );
      }
    }
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMonitoring) {
      await audio.stopMonitoring();
      setMonitoring(false);
      setStatus('Stopped.');
      setLevel(0);
    } else {
      try {
        trackerRef.current?.setThresholds({ minConfidence: settings.alertConfidence });
        sessionStartRef.current = Date.now();
        setPeakLevel(0);
        await audio.startMonitoring(onWindow);
        setMonitoring(true);
        setStatus('Monitoring — listening for airborne contacts…');
      } catch (e) {
        Alert.alert('Cannot start', String(e));
        setStatus('Start failed: ' + String(e));
      }
    }
  };

  const onReport = async () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    try {
      const uri = await writeReport({
        startTime: sessionStartRef.current || Date.now(),
        endTime: Date.now(),
        threats: tracker.getSessionLog(),
      });
      await Share.share({ url: uri, message: 'Corvus Sentinel After-Action Report' });
    } catch (e) {
      Alert.alert('Report', 'Saved/share error: ' + String(e));
    }
  };

  const patchSettings = (patch: Partial<SettingsState>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.alertConfidence != null) {
        trackerRef.current?.setThresholds({ minConfidence: patch.alertConfidence });
      }
      if (patch.voiceEnabled != null && voiceRef.current) {
        voiceRef.current.setApiKey(patch.voiceEnabled ? API_KEY : '');
      }
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#1A2332' }}>
      <StatusBar barStyle="light-content" />
      {screen === 'sentinel' && (
        <SentinelScreen
          isMonitoring={isMonitoring}
          modelReady={modelReady}
          statusText={statusText}
          level={level}
          peakLevel={peakLevel}
          onResetPeak={() => setPeakLevel(0)}
          threats={threats}
          lastAlert={lastAlert}
          onToggle={toggle}
          onReport={onReport}
          onNavigate={(sc) => setScreen(sc)}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen settings={settings} onChange={patchSettings} onBack={() => setScreen('sentinel')} />
      )}
      {screen === 'detections' && (
        <DetectionsScreen log={trackerRef.current?.getSessionLog() ?? []} onBack={() => setScreen('sentinel')} />
      )}
    </View>
  );
}
