/**
 * Avatar — agent identity bubble (PLAN.md §8 Unit K).
 * Renders the locally-picked profile photo when one exists, else falls back to
 * the shared tinted monogram (identical styling to AgentRow's MonogramAvatar
 * so rows stay visually consistent before/after a photo lands).
 */
import { Image, StyleSheet, Text, View } from 'react-native';

import { monogramFor } from '@/src/components/AgentRow';
import { useAgentPhoto } from '@/src/lib/profilePhotos';
import { useTheme, type Theme } from '@/src/theme';

interface AvatarProps {
  name: string;
  /** Diameter in dp. */
  size?: number;
}

export function Avatar({ name, size = 44 }: AvatarProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const photoUri = useAgentPhoto(name);

  if (photoUri !== null) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
        }}
        accessibilityLabel={`${name} profile photo`}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${theme.colors.accent}26`, // accent @ ~15%
        },
      ]}
    >
      <Text
        style={[
          styles.monogram,
          { fontSize: Math.round(size * 0.36), color: theme.colors.accent },
        ]}
      >
        {monogramFor(name)}
      </Text>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    fallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogram: {
      fontWeight: '700',
      letterSpacing: 0.5,
    },
  });
