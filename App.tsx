import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Share, StatusBar, View } from 'react-native';

import LaunchScreen from './app/LaunchScreen';
import SentinelScreen from './app/SentinelScreen';
import SettingsScreen, { SettingsState } from './app/SettingsScreen';
import DetectionsScreen from './app/DetectionsScreen';
import ContactDetailScreen from './app/ContactDetailScreen';
import RemoteIdScreen from './app/RemoteIdScreen';
import MapScreen from './app/MapScreen';
import TrainingCaptureScreen from './app/TrainingCaptureScreen';
import AnalysisScreen from './app/AnalysisScreen';

import AudioCaptureService from './lib/audioCapture';
import DroneClassifier, { CorvusModel } from './lib/mlClassifier';
import ThreatTracker, { Threat, AlertEvent } from './lib/threatTracker';
import CorvusVoice from './lib/corvusVoice';
import { writeReport } from './lib/reportGenerator';
import { initNotifications, notifyIntercept } from './lib/notifications';
import { initLocation, startLocation, stopLocation, getLastFix } from './lib/locationService';
import { saveSpecimen, pendingCount } from './lib/specimenStore';
import { syncPending } from './lib/specimenSync';
import { logDetection } from './lib/missionLog';
import corvusModelJson from './assets/models/corvus-model.json';

type ScreenName = 'sentinel' | 'settings' | 'detections' | 'remoteid' | 'map' | 'training' | 'analysis';

// NOTE: the ElevenLabs key is NEVER bundled here. Any EXPO_PUBLIC_* var is baked
// into the APK and is trivially extractable, so voice synthesis is proxied
// server-side via ocws-site (/api/elevenlabs/speak). See lib/corvusVoice.ts.
const SILENCE_RMS = 0.004; // below this, treat window as silence (force "None")

export default function App() {
  const [showLaunch, setShowLaunch] = useState(true); // branded first-open hero
  const [screen, setScreen] = useState<ScreenName>('sentinel');
  const [isMonitoring, setMonitoring] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [statusText, setStatus] = useState('Initializing…');
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0); // peak-hold for the rotate-to-peak locate aid
  const [threats, setThreats] = useState<Threat[]>([]);
  const [selectedThreat, setSelectedThreat] = useState<Threat | null>(null);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    voiceEnabled: true,
    hapticsEnabled: true,
    alertConfidence: 85,
  });

  const audioRef = useRef<AudioCaptureService | null>(null);
  const clfRef = useRef<DroneClassifier | null>(null);
  const trackerRef = useRef<ThreatTracker | null>(null);
  const voiceRef = useRef<CorvusVoice | null>(null);
  const sessionStartRef = useRef<number>(0);
  const sessionOriginRef = useRef<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const latestWindowRef = useRef<Float32Array | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [specimenCount, setSpecimenCount] = useState(0);

  // Capture an unknown/homemade contact's audio window + verdict into the local
  // specimen library (the learning flywheel). Auto on new unknown builds; also
  // available manually from the Contact Detail card.
  const captureSpecimen = useCallback((t: Threat) => {
    const win = latestWindowRef.current;
    if (!win) return;
    saveSpecimen(
      {
        timestamp: Date.now(),
        label: t.type,
        isUnknownBuild: !!t.isUnknownBuild,
        confidence: t.confidence,
        estFundamentalHz: t.estFundamentalHz ?? null,
        sizeClass: t.sizeClass ?? null,
        oodScore: t.oodScore ?? null,
        distance: t.distance,
        lat: t.lat ?? null,
        lon: t.lon ?? null,
      },
      win,
      corvusModelJson.dsp.sampleRate
    )
      .then(() => pendingCount())
      .then(setSpecimenCount)
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const clf = new DroneClassifier(corvusModelJson as unknown as CorvusModel);
      clfRef.current = clf;
      trackerRef.current = new ThreatTracker();
      trackerRef.current.setThresholds({ minConfidence: settings.alertConfidence });
      voiceRef.current = new CorvusVoice({ enabled: settings.voiceEnabled });
      audioRef.current = new AudioCaptureService({
        sampleRate: corvusModelJson.dsp.sampleRate,
        windowSec: corvusModelJson.dsp.clipSec,
        hopSec: 1.0,
      });
      setModelReady(clf.ready());
      setStatus(clf.ready() ? 'Ready. Model loaded.' : 'Model failed to load.');
      pendingCount().then(setSpecimenCount).catch(() => {});
    } catch (e) {
      setStatus('Init error: ' + String(e));
    }
    return () => {
      audioRef.current?.stopMonitoring();
      stopLocation();
      voiceRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindow = useCallback((win: Float32Array, rms: number) => {
    const clf = clfRef.current;
    const tracker = trackerRef.current;
    if (!clf || !tracker) return;

    latestWindowRef.current = win; // keep the latest window for specimen capture

    const lvl = Math.min(1, rms * 12);
    setLevel(lvl);
    setPeakLevel((p) => Math.max(p, lvl)); // hold the loudest reading for rotate-to-peak

    const result = clf.classifySamples(win);
    const label = rms < SILENCE_RMS ? 'None' : result.label;
    const fix = getLastFix();

    const alerts = tracker.update({
      label,
      confidence: result.confidence,
      distance: result.distance,
      bearing: result.bearing,
      timestamp: Date.now(),
      lat: fix?.lat ?? null,
      lon: fix?.lon ?? null,
      locationAccuracy: fix?.accuracy ?? null,
      isUnknownBuild: result.openSet.isUnknownBuild,
      estFundamentalHz: result.openSet.estFundamentalHz,
      sizeClass: result.openSet.sizeClass,
      oodScore: result.openSet.oodScore,
      voicePresent: result.voicePresent,
    });

    setThreats(tracker.getActiveThreats());

    // Log to SQLite for post-mission analysis: any drone hit or voice activity.
    const droneHit = label !== 'None' && result.droneDetected;
    if (droneHit || result.voicePresent) {
      logDetection({
        ts: result.timestamp,
        droneDetected: droneHit,
        label,
        confidence: result.confidence,
        voicePresent: result.voicePresent,
        filteredAudioPeak: result.filteredAudioPeak,
        lat: fix?.lat ?? null,
        lon: fix?.lon ?? null,
      });
    }

    // Notify on every NEW intercept so a minimized/backgrounded operator is alerted.
    for (const a of alerts) {
      if (a.type === 'new_threat') {
        const d = a.threat.distance;
        notifyIntercept(
          `New contact: ${a.threat.type}`,
          `~${Math.round(d * 0.65)}–${Math.round(d * 1.55)} ft • ${Math.round(a.threat.confidence)}% confidence`
        );
        // Auto-capture unknown/homemade builds into the specimen library.
        if (a.threat.isUnknownBuild) captureSpecimen(a.threat);
      }
    }

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
      stopLocation();
      setMonitoring(false);
      setStatus('Stopped.');
      setLevel(0);
    } else {
      try {
        trackerRef.current?.setThresholds({ minConfidence: settings.alertConfidence });
        sessionStartRef.current = Date.now();
        setPeakLevel(0);
        // Permissions + GPS for intercept alerts and stamping (best-effort).
        await initNotifications();
        await initLocation();
        await startLocation();
        const fix = getLastFix();
        sessionOriginRef.current = fix ? { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy } : null;
        // Flush any queued specimens to the shared library if a network is up.
        syncPending().then(() => pendingCount()).then(setSpecimenCount).catch(() => {});
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
        origin: sessionOriginRef.current,
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
        voiceRef.current.setEnabled(patch.voiceEnabled);
      }
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#1A2332' }}>
      <StatusBar barStyle="light-content" />
      {showLaunch && <LaunchScreen onEnter={() => setShowLaunch(false)} />}
      {screen === 'sentinel' && (
        <SentinelScreen
          isMonitoring={isMonitoring}
          modelReady={modelReady}
          statusText={statusText}
          level={level}
          peakLevel={peakLevel}
          onResetPeak={() => setPeakLevel(0)}
          specimenCount={specimenCount}
          threats={threats}
          lastAlert={lastAlert}
          onToggle={toggle}
          onReport={onReport}
          onSelectThreat={(t) => setSelectedThreat(t)}
          onNavigate={(sc) => {
            // Training capture needs the mic exclusively — stop live monitoring.
            if (sc === 'training' && isMonitoring) {
              audioRef.current?.stopMonitoring();
              setMonitoring(false);
              setLevel(0);
            }
            setScreen(sc);
          }}
        />
      )}
      {selectedThreat && (
        <ContactDetailScreen
          threat={selectedThreat}
          onClose={() => setSelectedThreat(null)}
          onRecord={captureSpecimen}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen settings={settings} onChange={patchSettings} onBack={() => setScreen('sentinel')} />
      )}
      {screen === 'detections' && (
        <DetectionsScreen log={trackerRef.current?.getSessionLog() ?? []} onBack={() => setScreen('sentinel')} />
      )}
      {screen === 'remoteid' && <RemoteIdScreen onBack={() => setScreen('sentinel')} />}
      {screen === 'map' && (
        <MapScreen onBack={() => setScreen('sentinel')} operator={getLastFix()} threats={threats} />
      )}
      {screen === 'training' && <TrainingCaptureScreen onBack={() => setScreen('sentinel')} />}
      {screen === 'analysis' && <AnalysisScreen onBack={() => setScreen('sentinel')} />}
    </View>
  );
}
