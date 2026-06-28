// theme.ts -- OCWS Corvus Sentinel design system.
// Tactical dark UI built around the brand: navy field, concentric radar rings,
// teal glow, gold accent. Condensed display type (Rajdhani) + mono data
// readouts (JetBrains Mono). Legacy COLORS keys are preserved so older code
// keeps compiling during the redesign.

export const COLORS = {
  // ---- surfaces ----
  bg: '#080D16', // deepest field (screen base)
  bgMid: '#0A1020',
  bgTop: '#11203A', // top glow tint for the gradient
  darkNavy: '#0B1422', // legacy name, now slightly deeper
  panel: '#0E1A2B', // card
  panelAlt: '#0A1626',
  panelBorder: '#1B2C44', // hairline card border
  divider: '#15263D',

  // ---- accents ----
  teal: '#00C2C7',
  tealLight: '#00C2C7', // legacy alias
  tealDark: '#0D6E7A',
  tealGlow: 'rgba(0,194,199,0.22)',
  gold: '#C9A23A',

  // ---- text ----
  ink: '#EAF2F8',
  lightGray: '#EAF2F8', // legacy alias
  muted: '#7E8C9E',
  faint: '#46586E',

  // ---- status ----
  danger: '#FF4D52',
  warning: '#F5A623',
  amber: '#F5A623',
  ok: '#2ECC71',
};

// LinearGradient stops for a screen background (top glow -> deep field).
export const BG_GRADIENT = [COLORS.bgTop, COLORS.bgMid, COLORS.bg] as const;

// Font families (loaded via @expo-google-fonts in App.tsx). RN falls back to
// system fonts until they finish loading.
export const FONTS = {
  display: 'Rajdhani_600SemiBold', // headers / labels
  displayBold: 'Rajdhani_700Bold', // emphasis
  body: 'Rajdhani_500Medium', // UI text
  mono: 'JetBrainsMono_500Medium', // numeric readouts
  monoR: 'JetBrainsMono_400Regular',
};

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const RADII = { sm: 8, md: 11, lg: 14, pill: 22, card: 14 };

// Severity color by estimated range (ft): close = danger, mid = amber, far = teal.
export const sevColor = (distanceFt: number): string =>
  distanceFt < 150 ? COLORS.danger : distanceFt < 300 ? COLORS.warning : COLORS.teal;

// Honest range band for a loudness-derived distance estimate.
export const rangeBand = (distanceFt: number): string =>
  `~${Math.max(30, Math.round(distanceFt * 0.65))}–${Math.min(1500, Math.round(distanceFt * 1.55))} ft`;
