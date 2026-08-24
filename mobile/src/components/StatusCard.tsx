/**
 * StatusCard — reusable console card shell (Unit D).
 * Soft surface + hairline border per the ChatGPT/OpenAI design bar (PLAN.md §0).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/src/theme';

interface StatusCardProps {
  /** Card heading rendered in the title row. Omit for chromeless cards. */
  title?: string;
  /** Right-aligned element in the title row (state dot, pill, counter…). */
  accessory?: ReactNode;
  children: ReactNode;
}

export function StatusCard({ title, accessory, children }: StatusCardProps) {
  const theme = useTheme();
  const styles = makeStyles(theme.colors);

  const showHeader = Boolean(title) || Boolean(accessory);

  return (
    <View style={styles.card}>
      {showHeader ? (
        <View style={styles.header}>
          {title ? (
            <Text style={[theme.type.headline, { color: theme.colors.textPrimary }]}>
              {title}
            </Text>
          ) : null}
          {accessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
    },
    header: {
      minHeight: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
  });
