/**
 * Design tokens — ChatGPT/OpenAI-app-inspired palette.
 * Clean, calm, professional agent-console aesthetic (PLAN.md §0).
 * StyleSheet-only; no UI kit.
 */
import { useColorScheme } from 'react-native';

import type { AgentState } from './lib/types';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export interface ThemeColors {
  /** Screen background */
  background: string;
  /** Card / elevated surface */
  surface: string;
  /** Hairline separators */
  border: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Brand accent — Elia green */
  accent: string;
}

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F7F7F8',
  border: 'rgba(0,0,0,0.06)',
  textPrimary: '#0D0D0D',
  textSecondary: '#5D5D63',
  textTertiary: '#8E8E93',
  accent: '#10A37F',
};

export const darkColors: ThemeColors = {
  background: '#0D0D0D',
  surface: '#1E1E20',
  border: 'rgba(255,255,255,0.08)',
  textPrimary: '#F7F7F8',
  textSecondary: '#B4B4BA',
  textTertiary: '#8E8E93',
  accent: '#10A37F',
};

/** Per-agent-state colors — identical in both modes for instant recognition. */
export const stateColors: Record<AgentState, string> = {
  running: '#10A37F',
  idle: '#8E8E93',
  disabled: '#C7C7CC',
  error: '#EF4444',
  done: '#30D158',
};

// ---------------------------------------------------------------------------
// Layout + typography
// ---------------------------------------------------------------------------

export const SPACING_VALUES = [4, 8, 12, 16, 20, 24] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
} as const;

export const typeScale = {
  largeTitle: { fontSize: 28, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '600' },
  headline: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;

// ---------------------------------------------------------------------------
// Theme hook
// ---------------------------------------------------------------------------

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  stateColors: Record<AgentState, string>;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof typeScale;
}

const lightTheme: Theme = {
  dark: false,
  colors: lightColors,
  stateColors,
  spacing,
  radius,
  type: typeScale,
};

const darkTheme: Theme = {
  dark: true,
  colors: darkColors,
  stateColors,
  spacing,
  radius,
  type: typeScale,
};

/** Current theme based on the OS color scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
