/**
 * VipGateScreen.tsx -- hard-wired VIP access gate shown after the launch splash
 * and before the app. Drives the flow in lib/vipAccess.ts:
 *
 *   code   -> first-ever unlock: enter the VIP access code (Corvus-Houston)
 *   create -> first use: set a password (new + confirm)
 *   login  -> returning operator: enter password (code no longer required)
 *   welcome-> one-time white-rabbit greeting from Corvus, then into the app
 *
 * Fully offline and self-contained (theme + vipAccess only) so it ports to the
 * other OCWS apps unchanged.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS, FONTS } from '../lib/theme';
import {
  WHITE_RABBIT_MESSAGE,
  acceptCode,
  hasPassword,
  markWelcomeShown,
  setPassword,
  shouldShowWelcome,
  verifyPassword,
} from '../lib/vipAccess';

type Phase = 'loading' | 'code' | 'create' | 'login' | 'welcome';

export default function VipGateScreen({ onUnlock }: { onUnlock: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Decide the entry phase: returning operators (password set) skip the code.
  useEffect(() => {
    hasPassword()
      .then((has) => setPhase(has ? 'login' : 'code'))
      .catch(() => setPhase('code'));
  }, []);

  const reset = () => {
    setError(null);
    setPw('');
    setPw2('');
  };

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await acceptCode(code);
      if (!ok) {
        setError('Access code not recognized.');
        return;
      }
      reset();
      setPhase('create');
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    setError(null);
    if (pw.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (pw !== pw2) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await setPassword(pw);
      reset();
      // Creating the password IS the first login -> white-rabbit greeting.
      setPhase('welcome');
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await verifyPassword(pw);
      if (!ok) {
        setError('Incorrect password.');
        setPw('');
        return;
      }
      reset();
      if (await shouldShowWelcome()) {
        setPhase('welcome');
      } else {
        finish();
      }
    } finally {
      setBusy(false);
    }
  };

  const dismissWelcome = async () => {
    await markWelcomeShown();
    finish();
  };

  const finish = () => onUnlock();

  return (
    <View style={s.fill}>
      <StatusBar barStyle="light-content" />
      <Image
        source={require('../assets/branding/launch-hero.png')}
        style={s.bg}
        resizeMode="contain"
      />
      <View style={s.scrim} />

      <View style={s.card}>
        {phase === 'loading' && <ActivityIndicator color={COLORS.teal} />}

        {phase === 'code' && (
          <>
            <Text style={s.title}>VIP ACCESS</Text>
            <Text style={s.sub}>Enter your access code to continue.</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              placeholder="Access code"
              placeholderTextColor={COLORS.faint}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={submitCode}
            />
            <PrimaryButton label="UNLOCK" onPress={submitCode} busy={busy} />
          </>
        )}

        {phase === 'create' && (
          <>
            <Text style={s.title}>SET PASSWORD</Text>
            <Text style={s.sub}>Access granted. Create a password for future logins.</Text>
            <TextInput
              style={s.input}
              value={pw}
              onChangeText={setPw}
              placeholder="New password"
              placeholderTextColor={COLORS.faint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TextInput
              style={s.input}
              value={pw2}
              onChangeText={setPw2}
              placeholder="Confirm password"
              placeholderTextColor={COLORS.faint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={submitCreate}
            />
            <PrimaryButton label="CREATE & ENTER" onPress={submitCreate} busy={busy} />
          </>
        )}

        {phase === 'login' && (
          <>
            <Text style={s.title}>WELCOME BACK</Text>
            <Text style={s.sub}>Enter your password to continue.</Text>
            <TextInput
              style={s.input}
              value={pw}
              onChangeText={setPw}
              placeholder="Password"
              placeholderTextColor={COLORS.faint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={submitLogin}
            />
            <PrimaryButton label="LOG IN" onPress={submitLogin} busy={busy} />
          </>
        )}

        {phase === 'welcome' && (
          <>
            <Text style={s.corvus}>CORVUS</Text>
            <Text style={s.rabbit}>{WHITE_RABBIT_MESSAGE}</Text>
            <PrimaryButton label="ENTER WONDERLAND" onPress={dismissWelcome} busy={busy} />
          </>
        )}

        {error && <Text style={s.error}>{error}</Text>}
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  busy,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <TouchableOpacity style={s.btn} onPress={onPress} activeOpacity={0.85} disabled={busy}>
      {busy ? (
        <ActivityIndicator color={COLORS.bg} />
      ) : (
        <Text style={s.btnText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.darkNavy },
  bg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,10,20,0.82)' },
  card: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 60,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderRadius: 14,
    padding: 22,
  },
  title: {
    color: COLORS.teal,
    fontFamily: FONTS.displayBold,
    fontSize: 22,
    letterSpacing: 3,
    marginBottom: 6,
  },
  sub: { color: COLORS.muted, fontFamily: FONTS.body, fontSize: 14, marginBottom: 16 },
  input: {
    backgroundColor: COLORS.panelAlt,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.ink,
    fontFamily: FONTS.mono,
    fontSize: 16,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: COLORS.teal,
    borderRadius: 22,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    color: COLORS.bg,
    fontFamily: FONTS.displayBold,
    fontSize: 15,
    letterSpacing: 2,
  },
  corvus: {
    color: COLORS.gold,
    fontFamily: FONTS.displayBold,
    fontSize: 16,
    letterSpacing: 4,
    marginBottom: 10,
  },
  rabbit: {
    color: COLORS.ink,
    fontFamily: FONTS.display,
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 20,
  },
  error: {
    color: COLORS.danger,
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
});
