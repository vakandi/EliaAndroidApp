/**
 * ErrorBanner — red-tinted dismissable alert strip (Unit D).
 * Tint is derived from the theme's error token so it tracks dark/light mode.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { stateColors, useTheme } from '@/src/theme';

interface ErrorBannerProps {
  /** Error message to surface (typically `lastError` from the store). */
  message: string;
  onDismiss: () => void;
}

/** Apply an alpha channel to a #RRGGBB theme token — same hue, softer fill. */
function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  const theme = useTheme();
  const styles = makeStyles(theme.colors);

  return (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Error: ${message}`}
    >
      <Text style={styles.mark}>!</Text>
      <Text style={[theme.type.caption, styles.message]}>{message}</Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        style={({ pressed }) => [styles.closeHit, pressed && styles.pressed]}
      >
        <Text style={[theme.type.caption, styles.close]}>✕</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) => {
  const tint = withAlpha(stateColors.error, colors.background === '#FFFFFF' ? 0.08 : 0.16);
  const edge = withAlpha(stateColors.error, 0.35);

  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: tint,
      borderColor: edge,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    mark: {
      width: 20,
      height: 20,
      lineHeight: 20,
      textAlign: 'center',
      borderRadius: 10,
      overflow: 'hidden',
      color: stateColors.error,
      backgroundColor: withAlpha(stateColors.error, 0.18),
      fontSize: 13,
      fontWeight: '700',
    },
    message: {
      flex: 1,
      color: stateColors.error,
      lineHeight: 17,
    },
    closeHit: {
      padding: 4,
      borderRadius: 8,
    },
    close: {
      color: colors.textSecondary,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.6,
    },
  });
};
