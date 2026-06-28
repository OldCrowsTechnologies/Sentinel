/**
 * RadarScope.tsx -- the home instrument. Concentric range rings + a sweep that
 * rotates only while monitoring (battery-friendly when idle). Contacts plot on
 * their range ring; bearing is used when known (RF/array), otherwise the blip is
 * a dashed marker on the ring to stay honest about acoustic-only direction.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Line, Path, G, Text as SvgText, Defs, RadialGradient, LinearGradient, Stop } from 'react-native-svg';
import { COLORS, FONTS, sevColor } from '../lib/theme';

const AG = Animated.createAnimatedComponent(G);
const C = 120; // center
const R = 108; // outer radius

export interface ScopeContact {
  id: string;
  distance: number; // ft (loudness estimate)
  bearing: number; // deg, <0 = unknown
  isUnknownBuild?: boolean;
}

function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function RadarScope({
  active,
  contacts,
  maxRangeFt = 600,
  size = 236,
}: {
  active: boolean;
  contacts: ScopeContact[];
  maxRangeFt?: number;
  size?: number;
}) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    if (active) {
      spin.setValue(0);
      loop = Animated.loop(
        Animated.timing(spin, { toValue: 360, duration: 4500, easing: Easing.linear, useNativeDriver: false })
      );
      loop.start();
    } else {
      spin.stopAnimation();
      spin.setValue(0);
    }
    return () => loop?.stop();
  }, [active, spin]);

  const rings = [0.31, 0.57, 0.83, 1]; // fractions of R
  const label1 = Math.round(maxRangeFt);
  const label2 = Math.round(maxRangeFt / 2);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 240 240">
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.22} />
            <Stop offset="55%" stopColor={COLORS.tealDark} stopOpacity={0.05} />
            <Stop offset="100%" stopColor={COLORS.teal} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor={COLORS.teal} stopOpacity={0} />
            <Stop offset="100%" stopColor={COLORS.teal} stopOpacity={0.38} />
          </LinearGradient>
        </Defs>

        <Circle cx={C} cy={C} r={R} fill="url(#glow)" />

        {rings.map((f, i) => (
          <Circle
            key={i}
            cx={C}
            cy={C}
            r={R * f}
            fill="none"
            stroke={i === rings.length - 1 ? '#2AA3AB' : '#1D8A92'}
            strokeOpacity={i === rings.length - 1 ? 0.7 : 0.42}
            strokeWidth={1}
          />
        ))}

        <Line x1={C} y1={C - R} x2={C} y2={C + R} stroke="#1D8A92" strokeOpacity={0.28} strokeWidth={1} />
        <Line x1={C - R} y1={C} x2={C + R} y2={C} stroke="#1D8A92" strokeOpacity={0.28} strokeWidth={1} />

        <SvgText x={C + 4} y={C - R * 0.83 + 9} fill={COLORS.faint} fontSize={8} fontFamily={FONTS.monoR}>
          {label1}ft
        </SvgText>
        <SvgText x={C + 4} y={C - R * 0.57 + 9} fill={COLORS.faint} fontSize={8} fontFamily={FONTS.monoR}>
          {label2}ft
        </SvgText>

        {active && (
          <AG rotation={spin as unknown as number} originX={C} originY={C}>
            <Path d={`M${C} ${C} L${C} ${C - R} A${R} ${R} 0 0 1 ${C + R * Math.sin(Math.PI / 3)} ${C - R * Math.cos(Math.PI / 3)} Z`} fill="url(#sweep)" />
          </AG>
        )}

        {/* contacts */}
        {contacts.map((t) => {
          const frac = Math.max(0.12, Math.min(1, t.distance / maxRangeFt));
          const r = R * frac;
          const ang = ((t.bearing >= 0 ? t.bearing : hashAngle(t.id)) * Math.PI) / 180;
          const x = C + r * Math.sin(ang);
          const y = C - r * Math.cos(ang);
          const col = t.isUnknownBuild ? COLORS.warning : sevColor(t.distance);
          const known = t.bearing >= 0;
          return (
            <G key={t.id}>
              <Circle cx={x} cy={y} r={12} fill={col} opacity={0.18} />
              {known ? (
                <Circle cx={x} cy={y} r={5} fill={col} />
              ) : (
                <Circle cx={x} cy={y} r={5} fill="none" stroke={col} strokeWidth={2} strokeDasharray="2 2" />
              )}
            </G>
          );
        })}

        {/* center drone glyph */}
        <G stroke="#CFE9EC" strokeWidth={2} fill="none" opacity={0.92}>
          <Circle cx={C} cy={C} r={9} />
          <Line x1={C - 9} y1={C - 9} x2={C - 17} y2={C - 17} />
          <Line x1={C + 9} y1={C - 9} x2={C + 17} y2={C - 17} />
          <Line x1={C - 9} y1={C + 9} x2={C - 17} y2={C + 17} />
          <Line x1={C + 9} y1={C + 9} x2={C + 17} y2={C + 17} />
        </G>
        <G fill="#CFE9EC">
          <Circle cx={C - 17} cy={C - 17} r={3.5} />
          <Circle cx={C + 17} cy={C - 17} r={3.5} />
          <Circle cx={C - 17} cy={C + 17} r={3.5} />
          <Circle cx={C + 17} cy={C + 17} r={3.5} />
        </G>
      </Svg>
    </View>
  );
}
