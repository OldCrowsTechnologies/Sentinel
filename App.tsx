import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Share, StatusBar, View } from 'react-native';
import { useFonts } from 'expo-font';
import { Rajdhani_500Medium, Rajdhani_600SemiBold, Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

import LaunchScreen from './app/LaunchScreen';
import SentinelScreen from './app/SentinelScreen';
import SettingsScreen, { SettingsState } from './app/SettingsScreen';
import DetectionsScreen from './app/DetectionsScreen';
import ContactDetailScreen from './app/ContactDetailScreen';
import RemoteIdScreen from './app/RemoteIdScreen';
import MapScreen from './app/MapScreen';
import TrainingCaptureScreen from './app/TrainingCaptureScreen';
import AnalysisScreen from './app/AnalysisScreen';
import LibraryScreen from './app/LibraryScreen';
import { ScreenBG, TabBar, TabKey } from './app/ui';
import { COLORS } from './lib/theme';

import AudioCaptureService from './lib/audioCapture';
import DroneClassifier, { CorvusModel } from './lib/mlClassifier';
import ThreatTracker, { Threat, AlertEvent, Detection } from './lib/threatTracker';
import { reportFromDetection, type ContactReport } from './lib/meshTypes';
import { startMesh, stopMesh, broadcastReport } from './lib/meshTransport';
import { fuseReports, type FusedTrack } from './lib/meshFusion';
import CorvusVoice from './lib/corvusVoice';
import { writeReport } from './lib/reportGenerator';
import { initNotifications, notifyIntercept } from './lib/notifications';
import { initLocation, startLocation, stopLocation, getLastFix } from './lib/locationService';
import { saveSpecimen, pendingCount } from './lib/specimenStore';
import { syncPending } from './lib/specimenSync';
import { queueFinding, syncFindings } from './lib/findingsSync';
import { logDetection } from './lib/missionLog';
import corvusModelJson from './assets/models/corvus-model.json';

type SubScreen = 'detections' | 'analysis' | 'training' | null;

// NOTE: the ElevenLabs key is NEVER bundled here. Any EXPO_PUBLIC_* var is baked
// into the APK and is trivially extractable, so voice synthesis is proxied
// server-side via ocws-site (/api/elevenlabs/speak). See lib/corvusVoice.ts.
const SILENCE_RMS = 0.004; // below this, treat window as silence (force "None")

export default function App() {
  const [fontsLoaded] = useFonts({
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  const [showLaunch, setShowLaunch] = useState(true);
  const [tab, setTab] = useState<TabKey>('monitor');
  const [sub, setSub] = useState<SubScreen>(null);
  const [isMonitoring, setMonitoring] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [statusText, setStatus] = useState('Initializing…');
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [fusedTracks, setFusedTracks] = useState<FusedTrack[]>([]);
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

  // --- Phase 3 mesh: rolling window of contact reports (this node + peers) that
  // fuseReports() localizes. Single-phone stays empty of peers, so fusion yields
  // no fix and the map shows range rings (today's behavior); add ≥3 positioned
  // nodes and ellipses appear. Node id is per-launch until persistence lands.
  const nodeIdRef = useRef<string>('');
  if (!nodeIdRef.current) nodeIdRef.current = 'self-' + Date.now().toString(36);
  const seqRef = useRef(0);
  const reportsRef = useRef<ContactReport[]>([]);

  const MESH_WINDOW_MS = 60000;
  const ingestReport = useCallback((rep: ContactReport) => {
    const cutoff = Date.now() - MESH_WINDOW_MS;
    reportsRef.current = [...reportsRef.current, rep].filter((r) => r.t >= cutoff);
    setFusedTracks(fuseReports(reportsRef.current));
  }, []);

  // Register the mesh receive sink (inert while the transport is slaved off, but
  // wired so peer reports flow into fusion the moment a native transport lands).
  useEffect(() => {
    startMesh((rep) => ingestReport(rep));
    return () => stopMesh();
  }, [ingestReport]);

  // Internet fleet-sync tier: while monitoring, every 30s flush queued findings +
  // pull peers' so a device that gains a network auto-publishes and catches up.
  // No-ops offline / when no endpoint is configured. Ungated (no sign-in).
  useEffect(() => {
    if (!isMonitoring) return;
    const id = setInterval(() => {
      void syncFindings(nodeIdRef.current);
    }, 30000);
    return () => clearInterval(id);
  }, [isMonitoring]);

  const [specimenCount, setSpecimenCount] = useState(0);

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

    latestWindowRef.current = win;

    const lvl = Math.min(1, rms * 12);
    setLevel(lvl);
    setPeakLevel((p) => Math.max(p, lvl));

    const result = clf.classifySamples(win);
    const label = rms < SILENCE_RMS ? 'None' : result.label;
    const fix = getLastFix();

    const det: Detection = {
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
    };

    const alerts = tracker.update(det);

    setThreats(tracker.getActiveThreats());

    // Publish real contacts to the mesh (broadcast is inert until a native
    // transport lands) and fold this node's own report into fusion.
    if (label !== 'None') {
      const rep = reportFromDetection(det, nodeIdRef.current, seqRef.current++);
      broadcastReport(rep); // offline P2P tier (inert until a native transport lands)
      queueFinding(rep); // internet tier: auto-publishes whenever a network is available
      ingestReport(rep);
    }

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

    for (const a of alerts) {
      if (a.type === 'new_threat') {
        const d = a.threat.distance;
        notifyIntercept(
          `New contact: ${a.threat.type}`,
          `~${Math.round(d * 0.65)}–${Math.round(d * 1.55)} ft • ${Math.round(a.threat.confidence)}% confidence`
        );
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
  }, [captureSpecimen, ingestReport]);

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
        await initNotifications();
        await initLocation();
        await startLocation();
        const fix = getLastFix();
        sessionOriginRef.current = fix ? { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy } : null;
        syncPending().then(() => pendingCount()).then(setSpecimenCount).catch(() => {});
        syncFindings(nodeIdRef.current).catch(() => {}); // publish/pull findings on start
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
      if (patch.alertConfidence != null) trackerRef.current?.setThresholds({ minConfidence: patch.alertConfidence });
      if (patch.voiceEnabled != null && voiceRef.current) voiceRef.current.setEnabled(patch.voiceEnabled);
      return next;
    });
  };

  const stopForExclusiveMic = () => {
    if (isMonitoring) {
      audioRef.current?.stopMonitoring();
      stopLocation();
      setMonitoring(false);
      setLevel(0);
    }
  };

  const openSub = (s: SubScreen) => {
    if (s === 'training') stopForExclusiveMic();
    setSub(s);
  };

  const changeTab = (t: TabKey) => {
    setSub(null);
    setTab(t);
  };

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  }

  const renderMain = () => {
    if (tab === 'monitor')
      return (
        <ScreenBG>
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
            onSelectThreat={setSelectedThreat}
          />
        </ScreenBG>
      );
    if (tab === 'map') return <MapScreen operator={getLastFix()} threats={threats} fusedTracks={fusedTracks} />;
    if (tab === 'rf')
      return (
        <ScreenBG>
          <RemoteIdScreen />
        </ScreenBG>
      );
    if (tab === 'settings')
      return (
        <ScreenBG>
          <SettingsScreen settings={settings} onChange={patchSettings} />
        </ScreenBG>
      );
    // library tab (hub + sub-screens)
    return (
      <ScreenBG>
        {sub === 'detections' ? (
          <DetectionsScreen log={trackerRef.current?.getSessionLog() ?? []} onBack={() => setSub(null)} />
        ) : sub === 'analysis' ? (
          <AnalysisScreen onBack={() => setSub(null)} />
        ) : sub === 'training' ? (
          <TrainingCaptureScreen onBack={() => setSub(null)} />
        ) : (
          <LibraryScreen specimenCount={specimenCount} sessionCount={trackerRef.current?.getSessionLog().length ?? 0} onOpen={openSub} />
        )}
      </ScreenBG>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>{renderMain()}</View>
      {!showLaunch && <TabBar active={tab} onChange={changeTab} />}

      {selectedThreat && (
        <ContactDetailScreen threat={selectedThreat} onClose={() => setSelectedThreat(null)} onRecord={captureSpecimen} />
      )}
      {showLaunch && <LaunchScreen onEnter={() => setShowLaunch(false)} />}
    </View>
  );
}
