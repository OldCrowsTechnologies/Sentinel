/**
 * ui.tsx -- shared design-system primitives for Corvus Sentinel.
 * Tactical dark surfaces, condensed display type, mono readouts, teal glow.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADII, BG_GRADIENT } from '../lib/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ---- screen background (top teal glow -> deep navy field) ----
export function ScreenBG({ children, padded = true }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={[...BG_GRADIENT] as [string, string, string]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, paddingTop: 50, paddingHorizontal: padded ? 16 : 0 }}>{children}</View>
    </View>
  );
}

// ---- small crow/brand mark ----
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: COLORS.teal,
        backgroundColor: COLORS.panelAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons name="feather" size={size * 0.56} color={COLORS.teal} />
    </View>
  );
}

// ---- header: brand title (monitor) or back + screen title ----
export function AppHeader({
  title,
  accent,
  onBack,
  right,
  brand,
}: {
  title: string;
  accent?: string; // teal-colored second word, e.g. "SENTINEL"
  onBack?: () => void;
  right?: React.ReactNode;
  brand?: boolean;
}) {
  return (
    <View style={h.row}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        {brand && <BrandMark />}
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={COLORS.teal} />
          </TouchableOpacity>
        )}
        <View>
          <Text style={h.title}>
            {title}
            {accent ? <Text style={{ color: COLORS.teal }}> {accent}</Text> : null}
          </Text>
          {brand && <Text style={h.sub}>ACOUSTIC C-UAS</Text>}
        </View>
      </View>
      {right ?? null}
    </View>
  );
}

// ---- status posture pill ----
export function Pill({ label, color, dot }: { label: string; color: string; dot?: boolean }) {
  return (
    <View style={[p.pill, { backgroundColor: color + '26', borderColor: color + '80', borderWidth: StyleSheet.hairlineWidth + 0.5 }]}>
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 6 }} />}
      <Text style={[p.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[pan.panel, style]}>{children}</View>;
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[pan.section, style]}>{children}</Text>;
}

export function MetricChip({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={pan.chip}>
      <Text style={[pan.chipValue, color ? { color } : null]}>{value}</Text>
      <Text style={pan.chipLabel}>{label}</Text>
    </View>
  );
}

export function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <View style={pan.kv}>
      <Text style={pan.kvKey}>{k}</Text>
      <Text style={[pan.kvVal, vColor ? { color: vColor } : null]}>{v}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  colors,
  onPress,
  disabled,
  glow,
  style,
}: {
  label: string;
  icon?: IconName;
  colors: [string, string];
  onPress: () => void;
  disabled?: boolean;
  glow?: string;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} disabled={disabled} style={[{ flex: 1, opacity: disabled ? 0.45 : 1 }, style]}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[btn.primary, glow ? { shadowColor: glow, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } : null]}
      >
        {icon && <MaterialCommunityIcons name={icon} size={18} color="#fff" style={{ marginRight: 8 }} />}
        <Text style={btn.primaryText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function IconButton({ icon, color, onPress }: { icon: IconName; color?: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={btn.icon} activeOpacity={0.8}>
      <MaterialCommunityIcons name={icon} size={20} color={color ?? COLORS.gold} />
    </TouchableOpacity>
  );
}

export function GhostButton({ label, icon, onPress, color }: { label: string; icon?: IconName; onPress: () => void; color?: string }) {
  const c = color ?? COLORS.teal;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[btn.ghost, { borderColor: c + '66' }]}>
      {icon && <MaterialCommunityIcons name={icon} size={16} color={c} style={{ marginRight: 7 }} />}
      <Text style={[btn.ghostText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={pan.empty}>
      <MaterialCommunityIcons name={icon} size={40} color={COLORS.faint} />
      <Text style={pan.emptyText}>{text}</Text>
    </View>
  );
}

// ---- bottom tab bar ----
export type TabKey = 'monitor' | 'map' | 'rf' | 'library' | 'settings';
const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: 'monitor', icon: 'radar', label: 'Monitor' },
  { key: 'map', icon: 'map-marker-radius', label: 'Map' },
  { key: 'rf', icon: 'broadcast', label: 'RF' },
  { key: 'library', icon: 'database', label: 'Library' },
  { key: 'settings', icon: 'cog', label: 'Settings' },
];

export function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  // Pad the bar above the system nav bar (gesture pill OR 3-button nav) so tabs
  // are never covered. insets.bottom is 0 on devices without a bottom inset, where
  // the base padding still applies. Fixes the every-device overlap.
  const insets = useSafeAreaInsets();
  return (
    <View style={[tb.bar, { paddingBottom: Math.max(10, insets.bottom) + 8 }]}>
      {TABS.map((t) => {
        const on = t.key === active;
        const c = on ? COLORS.teal : COLORS.muted;
        return (
          <TouchableOpacity key={t.key} style={tb.tab} onPress={() => onChange(t.key)} activeOpacity={0.7}>
            <MaterialCommunityIcons name={t.icon} size={22} color={c} />
            <Text style={[tb.label, { color: c }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const h = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  title: { fontFamily: FONTS.displayBold, color: COLORS.ink, fontSize: 19, letterSpacing: 1.5 },
  sub: { fontFamily: FONTS.display, color: COLORS.muted, fontSize: 9, letterSpacing: 2.5, marginTop: -2 },
});

const p = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  pillText: { fontFamily: FONTS.displayBold, fontSize: 10.5, letterSpacing: 1.2 },
});

const pan = StyleSheet.create({
  panel: { backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.panelBorder, borderRadius: RADII.md },
  section: { fontFamily: FONTS.displayBold, color: COLORS.gold, fontSize: 11, letterSpacing: 2, marginTop: 16, marginBottom: 7 },
  chip: { flex: 1, backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.panelBorder, borderRadius: RADII.md, paddingVertical: 8, alignItems: 'center' },
  chipValue: { fontFamily: FONTS.mono, color: COLORS.ink, fontSize: 20, fontWeight: '700' },
  chipLabel: { fontFamily: FONTS.display, color: COLORS.muted, fontSize: 9, letterSpacing: 1, marginTop: 1 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 12 },
  kvKey: { fontFamily: FONTS.body, color: COLORS.muted, fontSize: 12.5 },
  kvVal: { fontFamily: FONTS.mono, color: COLORS.ink, fontSize: 12.5, flexShrink: 1, textAlign: 'right', paddingLeft: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontFamily: FONTS.body, color: COLORS.muted, textAlign: 'center', marginTop: 10, fontSize: 13, lineHeight: 18 },
});

const btn = StyleSheet.create({
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: RADII.lg, paddingVertical: 14 },
  primaryText: { fontFamily: FONTS.displayBold, color: '#fff', fontSize: 15, letterSpacing: 2 },
  icon: { width: 52, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2A3D57', borderRadius: RADII.lg },
  ghost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: RADII.md, paddingVertical: 12, flex: 1 },
  ghostText: { fontFamily: FONTS.displayBold, fontSize: 12, letterSpacing: 1.2 },
});

const tb = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider, backgroundColor: '#0A1322' },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: FONTS.display, fontSize: 9.5, letterSpacing: 0.5 },
});
