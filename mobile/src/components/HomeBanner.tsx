import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSubworkersStore } from '@/src/lib/store';
import { useTheme } from '@/src/theme';

const BANNER_HEIGHT = 56;

type BannerState = 'connected' | 'connecting' | 'disconnected' | 'error';

function bannerConfig(state: BannerState, isDark: boolean) {
  switch (state) {
    case 'connected':
      return {
        label: 'LIVE',
        dotColor: '#10A37F',
        lineColor: '#10A37F',
        glyphColor: '#10A37F',
        form: 'shimmer' as const,
        shimmerDur: 2600,
        pulseDur: 900,
      };
    case 'connecting':
      return {
        label: 'CONNECTING…',
        dotColor: '#F59E0B',
        lineColor: '#F59E0B',
        glyphColor: '#F59E0B',
        form: 'breathe' as const,
        shimmerDur: 1400,
        pulseDur: 650,
      };
    case 'disconnected':
      return {
        label: 'OFFLINE',
        dotColor: isDark ? '#6B7280' : '#9CA3AF',
        lineColor: isDark ? '#3F3F46' : '#D4D4D8',
        glyphColor: isDark ? '#6B7280' : '#9CA3AF',
        form: 'static' as const,
        shimmerDur: 4200,
        pulseDur: 1600,
      };
    case 'error':
      return {
        label: 'ERROR',
        dotColor: '#EF4444',
        lineColor: '#EF4444',
        glyphColor: '#EF4444',
        form: 'glitch' as const,
        shimmerDur: 700,
        pulseDur: 350,
      };
  }
}

export default function HomeBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const connectionState = useSubworkersStore((s) => s.connectionState);
  const isDark = theme.colors.background === '#0D0D0D';

  const state: BannerState =
    connectionState === 'connected'
      ? 'connected'
      : connectionState === 'connecting'
        ? 'connecting'
        : connectionState === 'error'
          ? 'error'
          : 'disconnected';

  const cfg = bannerConfig(state, isDark);

  const shimmer = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const glitch = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    shimmer.setValue(0);
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: cfg.shimmerDur,
        easing: state === 'error' ? Easing.linear : Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [cfg.shimmerDur, state, shimmer]);

  useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: cfg.pulseDur,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: cfg.pulseDur,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cfg.pulseDur, pulse]);

  useEffect(() => {
    if (state !== 'error') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glitch, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(glitch, { toValue: 0, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(glitch, { toValue: 1, duration: 60, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(glitch, { toValue: 0, duration: 320, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, glitch]);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-180, 360] });
  const translateX2 = shimmer.interpolate({ inputRange: [0, 1], outputRange: [360, -180] });
  const breatheScale = shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1.25, 0.7] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: state === 'error' ? [0.3, 1] : state === 'disconnected' ? [0.35, 0.7] : [0.55, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: state === 'connecting' ? [0.85, 1.3] : state === 'error' ? [0.9, 1.5] : [0.9, 1.15] });
  const glitchOpacity = glitch.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top,
          height: BANNER_HEIGHT + insets.top,
          backgroundColor: theme.colors.background,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View pointerEvents="none" style={[styles.grid, { opacity: 0.05 }]} />

      <View style={styles.row}>
        <View style={[styles.mark, { backgroundColor: '#0D0D0D', borderColor: theme.colors.border }]}>
          <Text style={[styles.markGlyph, { color: cfg.glyphColor }]}>◈</Text>
        </View>

        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            ELIA<Text style={{ color: theme.colors.textTertiary, fontWeight: '400' }}>  ·  </Text>
            <Text style={{ color: cfg.lineColor }}>SUBWORKERS</Text>
          </Text>
          <Text style={[styles.sub, { color: theme.colors.textTertiary }]}>command center</Text>
        </View>

        <View style={styles.live}>
          <Animated.View
            style={[
              styles.liveDot,
              {
                backgroundColor: cfg.dotColor,
                opacity: state === 'disconnected' ? 0.6 : opacity,
                transform: [{ scale: state === 'disconnected' ? 1 : scale }],
              },
            ]}
          />
          <Text style={[styles.liveText, { color: state === 'error' ? cfg.dotColor : state === 'connecting' ? cfg.dotColor : theme.colors.textTertiary }]}>
            {cfg.label}
          </Text>
        </View>
      </View>

      {/* bottom accent — form changes per state */}
      <View style={styles.lineTrack}>
        {cfg.form === 'shimmer' && (
          <>
            <Animated.View style={[styles.lineShimmer, { backgroundColor: cfg.lineColor, transform: [{ translateX }], opacity: 0.9 }]} />
            <View style={[styles.lineGlow, { backgroundColor: cfg.lineColor }]} />
          </>
        )}
        {cfg.form === 'breathe' && (
          <>
            <Animated.View
              style={[
                styles.lineBreathe,
                { backgroundColor: cfg.lineColor, transform: [{ scaleX: breatheScale }], opacity: 0.95 },
              ]}
            />
            <View style={[styles.lineGlow, { backgroundColor: cfg.lineColor, opacity: 0.22 }]} />
          </>
        )}
        {cfg.form === 'static' && <View style={[styles.lineStatic, { backgroundColor: cfg.lineColor, opacity: 0.5 }]} />}
        {cfg.form === 'glitch' && (
          <>
            <Animated.View style={[styles.lineGlitchA, { backgroundColor: cfg.lineColor, transform: [{ translateX }], opacity: glitchOpacity }]} />
            <Animated.View style={[styles.lineGlitchB, { backgroundColor: cfg.lineColor, transform: [{ translateX: translateX2 }], opacity: 0.55 }]} />
            <View style={[styles.lineGlow, { backgroundColor: cfg.lineColor, opacity: 0.28 }]} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'flex-end' },
  grid: { ...StyleSheet.absoluteFill, backgroundColor: 'transparent' },
  row: { height: BANNER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 2 },
  mark: { width: 28, height: 28, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  markGlyph: { fontSize: 14, fontWeight: '800', lineHeight: 16 },
  copy: { flex: 1, gap: 1 },
  title: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2 },
  sub: { fontSize: 11, fontWeight: '500', letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.9 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  lineTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, overflow: 'hidden', backgroundColor: 'transparent' },
  lineGlow: { ...StyleSheet.absoluteFill, opacity: 0.18, height: 2 },
  lineShimmer: { position: 'absolute', top: 0, bottom: 0, width: 120, borderRadius: 999 },
  lineBreathe: { position: 'absolute', left: '18%', right: '18%', top: 0, bottom: 0, borderRadius: 999 },
  lineStatic: { ...StyleSheet.absoluteFill, height: 2 },
  lineGlitchA: { position: 'absolute', top: 0, bottom: 0, width: 90, borderRadius: 999 },
  lineGlitchB: { position: 'absolute', top: 0, bottom: 0, width: 46, borderRadius: 999 },
});

export const HOME_BANNER_HEIGHT = BANNER_HEIGHT;
