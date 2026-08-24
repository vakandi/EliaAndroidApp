/**
 * AgentRow — reusable list row for a subworker (PLAN.md §3 Agents list).
 * Also hosts the shared pure helpers used across the Agents experience
 * (state derivation, monograms, relative time formatting) so every screen
 * renders identical values.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AgentState, SubworkerInfo } from '@/src/lib/types';
import { useTheme, type Theme } from '@/src/theme';

import { StateBadge } from './StateBadge';

// ---------------------------------------------------------------------------
// Shared pure helpers (consumed by agents.tsx + agent/[name].tsx)
// ---------------------------------------------------------------------------

/** Sort priority: running > idle > done > disabled > error. */
export const STATE_ORDER: Record<AgentState, number> = {
  running: 0,
  idle: 1,
  done: 2,
  disabled: 3,
  error: 4,
};

/** Derive a display state from raw SubworkerInfo flags. */
export function deriveAgentState(sw: SubworkerInfo): AgentState {
  if (!sw.enabled) return 'disabled';
  if (sw.running) return 'running';
  if (sw.lastError != null && sw.lastError.trim() !== '') return 'error';
  if (!sw.nextRun && sw.lastCompleted != null) return 'done';
  return 'idle';
}

/** 1–2 letter monogram from an agent name ("mirorpay-promoter" → "MP"). */
export function monogramFor(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Human caption for nextRun ISO strings: "in 12m", "Due now", date fallback. */
export function formatNextRun(nextRun: string | null): string {
  if (!nextRun) return 'No run scheduled';
  const t = Date.parse(nextRun);
  if (Number.isNaN(t)) return nextRun;
  const diff = t - Date.now();
  if (diff <= -MINUTE_MS) return 'Starting…';
  if (diff < MINUTE_MS) return 'in <1m';
  if (diff < HOUR_MS) return `in ${Math.round(diff / MINUTE_MS)}m`;
  if (diff < DAY_MS) return `in ${Math.round(diff / HOUR_MS)}h`;
  if (diff < 7 * DAY_MS) return `in ${Math.round(diff / DAY_MS)}d`;
  return formatDateShort(t);
}

/** Human caption for lastCompleted epoch (s or ms heuristic). */
export function formatLastCompleted(ts: number | null): string {
  if (ts == null) return 'Never';
  const ms = ts < 1e11 ? ts * 1000 : ts; // seconds → ms
  const diff = Date.now() - ms;
  if (diff < MINUTE_MS) return 'Just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return formatDateShort(ms);
}

/** Circular tinted-monogram avatar shared by rows and the detail header. */
export function MonogramAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${theme.colors.accent}26`, // accent @ ~15%
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.36), color: theme.colors.accent }]}>
        {monogramFor(name)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface AgentRowProps {
  subworker: SubworkerInfo;
  /** Show the ★ main-agent marker next to the name. */
  isMainAgent?: boolean;
  /** Shows an inline spinner on this row's trigger button. */
  triggerPending?: boolean;
  onPress?: () => void;
  /** Quick trigger — omitted button when the subworker is disabled. */
  onTrigger?: () => void;
}

export function AgentRow({
  subworker,
  isMainAgent = false,
  triggerPending = false,
  onPress,
  onTrigger,
}: AgentRowProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const state = deriveAgentState(subworker);
  const canTrigger = subworker.enabled && !!onTrigger;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      android_ripple={{ color: theme.colors.border }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${subworker.name} details`}
    >
      <MonogramAvatar name={subworker.name} />

      <View style={styles.center}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {subworker.name}
          </Text>
          {isMainAgent && (
            <View style={styles.mainChip}>
              <Text style={styles.mainChipText}>★ Main</Text>
            </View>
          )}
        </View>
        <View style={styles.metaRow}>
          <StateBadge state={state} />
          <View style={styles.metaDot} />
          <Text style={styles.metaCaption} numberOfLines={1}>
            {formatNextRun(subworker.nextRun)}
          </Text>
        </View>
      </View>

      {canTrigger ? (
        <Pressable
          style={({ pressed }) => [styles.triggerBtn, pressed && styles.triggerPressed]}
          onPress={(e) => {
            e.stopPropagation();
            onTrigger?.();
          }}
          disabled={triggerPending}
          accessibilityRole="button"
          accessibilityLabel={`Trigger ${subworker.name} now`}
        >
          {triggerPending ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <Text style={styles.triggerText}>Run</Text>
          )}
        </Pressable>
      ) : (
        !subworker.enabled && <Text style={styles.offHint}>Off</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
    },
    cardPressed: {
      opacity: 0.85,
    },
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    center: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    name: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    mainChip: {
      backgroundColor: `${theme.colors.accent}1A`,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
    },
    mainChipText: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.accent,
      fontWeight: '600',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: theme.colors.textTertiary,
    },
    metaCaption: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      flexShrink: 1,
    },
    triggerBtn: {
      minWidth: 56,
      height: 32,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${theme.colors.accent}66`,
      backgroundColor: `${theme.colors.accent}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    triggerPressed: {
      opacity: 0.7,
    },
    triggerText: {
      ...theme.type.caption,
      fontWeight: '600',
      color: theme.colors.accent,
    },
    offHint: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
    },
  });
