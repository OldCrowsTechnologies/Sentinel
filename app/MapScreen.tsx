/**
 * MapScreen.tsx -- offline-capable tactical map (MapLibre + OpenStreetMap
 * raster). Plots:
 *   - the operator (GPS dot)
 *   - Remote ID contacts: real PINS for the drone AND the operator/pilot
 *   - acoustic contacts: RANGE RINGS around the operator (acoustic has no
 *     bearing, so an honest ring -- never a fake pin)
 *
 * Offline: viewed tiles are cached, and "Download AO" pre-caches the current
 * area. NOTE: offline tile behavior needs on-device validation; OSM tiles are a
 * free placeholder source (swap for owned/commercial tiles in production).
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  MapView,
  Camera,
  PointAnnotation,
  ShapeSource,
  LineLayer,
  setAccessToken,
  OfflineManager,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII } from '../lib/theme';
import { PrimaryButton } from './ui';
import type { Threat } from '../lib/threatTracker';
import { getRemoteIdContacts } from '../lib/remoteIdService';
import type { GeoFix } from '../lib/locationService';

setAccessToken(null); // MapLibre + OSM needs no token

const OSM_STYLE = JSON.stringify({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
});

const FT_TO_M = 0.3048;

// Circle polygon (LineString ring) around a center, radius in meters.
function ring(lat: number, lon: number, radiusM: number, pts = 48): number[][] {
  const coords: number[][] = [];
  const R = 6378137;
  const d = radiusM / R;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  for (let i = 0; i <= pts; i++) {
    const brng = (i / pts) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng)
    );
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      );
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

export default function MapScreen({
  operator,
  threats,
}: {
  operator: GeoFix | null;
  threats: Threat[];
}) {
  const [aoStatus, setAoStatus] = useState('');
  const rid = getRemoteIdContacts();
  const center: [number, number] = operator
    ? [operator.lon, operator.lat]
    : rid.find((r) => r.droneLon != null)
    ? [rid[0].droneLon as number, rid[0].droneLat as number]
    : [-98.5795, 39.8283]; // CONUS fallback

  // Acoustic range rings (band) around the operator.
  const ringFeatures =
    operator
      ? {
          type: 'FeatureCollection',
          features: threats.flatMap((t, i) =>
            [t.distance * 0.65, t.distance * 1.55].map((ft, j) => ({
              type: 'Feature',
              id: `${i}-${j}`,
              geometry: { type: 'LineString', coordinates: ring(operator.lat, operator.lon, ft * FT_TO_M) },
              properties: {},
            }))
          ),
        }
      : { type: 'FeatureCollection', features: [] };

  const downloadAO = async () => {
    setAoStatus('Caching area…');
    try {
      await OfflineManager.createPack(
        {
          name: `ao_${Math.round(center[0] * 1000)}_${Math.round(center[1] * 1000)}`,
          styleURL: `data:application/json;charset=utf-8,${encodeURIComponent(OSM_STYLE)}`,
          minZoom: 11,
          maxZoom: 16,
          bounds: [
            [center[0] - 0.08, center[1] - 0.08],
            [center[0] + 0.08, center[1] + 0.08],
          ],
        } as any,
        (_region: any, st: any) => {
          if (st && st.percentage != null) setAoStatus(`Caching area… ${Math.round(st.percentage)}%`);
        },
        () => setAoStatus('Offline cache error — validate on device.')
      );
      setAoStatus('Area cached for offline use.');
    } catch (e) {
      setAoStatus('Offline cache failed — validate on device.');
    }
  };

  return (
    <View style={s.container}>
      <MapView style={s.map} mapStyle={OSM_STYLE} logoEnabled={false} attributionEnabled>
        <Camera zoomLevel={14} centerCoordinate={center} />

        {operator && (
          <PointAnnotation id="operator" coordinate={[operator.lon, operator.lat]}>
            <View style={[s.dot, { backgroundColor: COLORS.teal, borderColor: '#fff' }]} />
          </PointAnnotation>
        )}

        {operator && threats.length > 0 && (
          <ShapeSource id="rings" shape={ringFeatures as any}>
            <LineLayer
              id="ringLine"
              style={{ lineColor: COLORS.warning, lineWidth: 1.5, lineOpacity: 0.7, lineDasharray: [2, 2] }}
            />
          </ShapeSource>
        )}

        {rid.map((c) =>
          c.droneLat != null && c.droneLon != null ? (
            <PointAnnotation key={`d-${c.id}`} id={`d-${c.id}`} coordinate={[c.droneLon, c.droneLat]}>
              <View style={[s.dot, { backgroundColor: COLORS.danger, borderColor: '#fff' }]} />
            </PointAnnotation>
          ) : null
        )}
        {rid.map((c) =>
          c.operatorLat != null && c.operatorLon != null ? (
            <PointAnnotation key={`o-${c.id}`} id={`o-${c.id}`} coordinate={[c.operatorLon, c.operatorLat]}>
              <View style={[s.square, { backgroundColor: COLORS.gold, borderColor: '#fff' }]} />
            </PointAnnotation>
          ) : null
        )}
      </MapView>

      <View style={s.legend}>
        <View style={s.titleRow}>
          <MaterialCommunityIcons name="map-marker-radius" size={15} color={COLORS.teal} style={{ marginRight: 6 }} />
          <Text style={s.title}>TACTICAL MAP</Text>
        </View>
        <Text style={s.legendText}>
          ● OPERATOR   ◐ ACOUSTIC RANGE RING   ● RID DRONE   ■ RID PILOT
        </Text>
        {!operator && <Text style={s.warn}>NO GPS FIX — ACOUSTIC RINGS NEED YOUR POSITION.</Text>}
        {aoStatus ? <Text style={s.ao}>{aoStatus}</Text> : null}
      </View>

      <View style={s.controls}>
        <PrimaryButton
          label="DOWNLOAD AO · OFFLINE"
          icon="cloud-download"
          colors={['#13B6BB', '#0D7E86']}
          onPress={downloadAO}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  map: { flex: 1 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  square: { width: 14, height: 14, borderWidth: 2 },
  legend: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(8,13,22,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.panelBorder,
    borderRadius: RADII.md,
    padding: 10,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  title: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 13, letterSpacing: 1.5 },
  legendText: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 11, letterSpacing: 0.5 },
  warn: { fontFamily: FONTS.body, color: COLORS.warning, fontSize: 11, marginTop: 5, letterSpacing: 0.5 },
  ao: { fontFamily: FONTS.body, color: COLORS.teal, fontSize: 11, marginTop: 5, letterSpacing: 0.5 },
  controls: { position: 'absolute', bottom: 14, left: 12, right: 12, flexDirection: 'row' },
});
