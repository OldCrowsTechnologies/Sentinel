/**
 * LaunchScreen.tsx -- branded splash on cold start. Shows the hero immediately
 * (no fade) so it's a seamless continuation of the native splash, then HOLDS on
 * a "TAP TO ENTER" button. It does not auto-advance -- the operator taps ENTER
 * to go into the monitor.
 */

import React from 'react';
import { Image, Text, View, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { COLORS } from '../lib/theme';

export default function LaunchScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <View style={s.fill}>
      <StatusBar barStyle="light-content" />
      <Image
        source={require('../assets/branding/launch-hero.png')}
        style={s.image}
        resizeMode="contain"
      />
      <View style={s.enterWrap}>
        <TouchableOpacity style={s.enterBtn} onPress={onEnter} activeOpacity={0.85}>
          <Text style={s.enterText}>TAP TO ENTER</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.darkNavy },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  enterWrap: { position: 'absolute', bottom: 44, left: 0, right: 0, alignItems: 'center' },
  enterBtn: {
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.tealLight,
    backgroundColor: '#0A1422CC',
  },
  enterText: { color: COLORS.tealLight, fontWeight: '800', letterSpacing: 2, fontSize: 14 },
});
