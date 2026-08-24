/**
 * StateBadge — small colored state DOT + quiet label (PLAN.md §0 design bar:
 * "small colored state DOTS not loud badges"). Colors come from
 * theme.stateColors so every screen reads states identically.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { AgentState } from '@/src/lib/types';
import { useTheme, type Theme } from '@/src/theme';

interface StateBadgeProps {
  state: AgentState;
  /** Hide the text label and render the dot alone. */
  dotOnly?: boolean;
}

const LABELS: Record<AgentState, string> = {
  running: 'Running',
  idle: 'Idle',
  disabled: 'Disabled',
  error: 'Error',
  done: 'Done',
};

export function StateBadge({ state, dotOnly = false }: StateBadgeProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const color = theme.stateColors[state];
  const label = LABELS[state];

  return (
    <View style={styles.wrap} accessibilityLabel={`Status: ${label}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {!dotOnly && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    label: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
    },
  });
