/**
 * LaunchScreen.tsx -- branded first-open hero shown on cold start (Crow's Eye
 * style). Displays the Corvus Sentinel hero art full-bleed, then advances into
 * the monitor on tap or after a short timeout. Pure branding -- it intentionally
 * shows the product vision; the live screens stay honest about current capability.
 */

import React, { useEffect, useRef } from 'react';
import { View, Image, Text, TouchableOpacity, StyleSheet, StatusBar, Animated } from 'react-native';
import { COLORS } from '../lib/theme';

const AUTO_ADVANCE_MS = 5000;

export default function LaunchScreen({ onEnter }: { onEnter: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
    const t = setTimeout(onEnter, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TouchableOpacity style={s.fill} activeOpacity={1} onPress={onEnter}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[s.fill, { opacity: fade }]}>
        <Image
          source={require('../assets/branding/launch-hero.png')}
          style={s.image}
          resizeMode="contain"
        />
        <View style={s.enterWrap}>
          <View style={s.enterPill}>
            <Text style={s.enterText}>TAP TO ENTER</Text>
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.darkNavy },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  enterWrap: { position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center' },
  enterPill: {
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: COLORS.tealLight,
    backgroundColor: '#0A1422AA',
  },
  enterText: { color: COLORS.tealLight, fontWeight: '800', letterSpacing: 2, fontSize: 13 },
});
