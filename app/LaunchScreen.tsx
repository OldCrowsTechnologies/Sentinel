/**
 * LaunchScreen.tsx -- branded splash on cold start. Shows the hero immediately
 * (no fade) so it's a seamless continuation of the native splash, holds ~3s,
 * then auto-advances into the monitor. Tapping anywhere skips early. No "tap to
 * enter" gate -- it just briefly shows and moves on.
 */

import React, { useEffect } from 'react';
import { Image, StyleSheet, StatusBar, TouchableWithoutFeedback, View } from 'react-native';
import { COLORS } from '../lib/theme';

const AUTO_ADVANCE_MS = 3000;

export default function LaunchScreen({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnter, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TouchableWithoutFeedback onPress={onEnter}>
      <View style={s.fill}>
        <StatusBar barStyle="light-content" />
        <Image
          source={require('../assets/branding/launch-hero.png')}
          style={s.image}
          resizeMode="contain"
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.darkNavy },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
});
