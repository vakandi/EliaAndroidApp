/**
 * Home dashboard (Unit D) — PLAN.md §3.
 * Live connection state · server health grid · agent counters · quick actions.
 * Consumes the shared zustand stores read-only; no mock data.
 */
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorBanner } from '@/src/components/ErrorBanner';
import { RecentChatsCard } from '@/src/components/RecentChatsCard';
import { StatusCard } from '@/src/components/StatusCard';
import { useSettingsStore } from '@/src/lib/settings';
import { useSubworkersStore } from '@/src/lib/store';
import type { ConnectionState } from '@/src/lib/types';
import { useTheme } from '@/src/theme';

/** Quick-trigger chip cap before handing off to the Agents tab (PLAN §3). */
const MAX_QUICK_TRIGGERS = 6;

/** Apply an alpha channel to a #RRGGBB theme token — same hue, softer fill. */
function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** First letters of name segments, e.g. "mirorpay-community" → "MC". */
function monogram(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('');
  return (initials || name.charAt(0)).toUpperCase();
}

interface ConnectionMeta {
  label: string;
  tone: 'accent' | 'muted' | 'error';
}

function connectionMeta(state: ConnectionState): ConnectionMeta {
  switch (state) {
    case 'connected':
      return { label: 'Connected', tone: 'accent' };
    case 'connecting':
      return { label: 'Connecting…', tone: 'muted' };
    case 'disconnected':
      return { label: 'Disconnected', tone: 'muted' };
    case 'error':
      return { label: 'Connection error', tone: 'error' };
  }
}

export default function HomeScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme.colors);

  const connectionState = useSubworkersStore((s) => s.connectionState);
  const serverHealth = useSubworkersStore((s) => s.serverHealth);
  const subworkers = useSubworkersStore((s) => s.subworkers);
  const lastError = useSubworkersStore((s) => s.lastError);
  const isLoading = useSubworkersStore((s) => s.isLoading);
  const reconnect = useSubworkersStore((s) => s.reconnect);
  const refreshNow = useSubworkersStore((s) => s.refreshNow);
  const triggerSubworker = useSubworkersStore((s) => s.triggerSubworker);

  // Read-only server URL (Settings owns writes).
  const serverUrl = useSettingsStore((s) => s.serverUrl);

  // Banner dismissal is local; a brand-new lastError always re-shows it.
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const visibleError =
    lastError && lastError !== dismissedError ? lastError : null;

  // Pull-to-refresh wraps the store action; failures land in lastError.
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on pull-to-refresh so RecentChatsCard re-fetches in sync.
  const [chatRefreshTick, setChatRefreshTick] = useState(0);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setChatRefreshTick((t) => t + 1);
    try {
      await refreshNow();
    } catch {
      // Store stubs may reject until Unit B lands — surfaced via lastError.
    } finally {
      setRefreshing(false);
    }
  }, [refreshNow]);

  const handleReconnect = useCallback(() => {
    try {
      reconnect();
    } catch {
      // Unit B stub throws synchronously until implemented — ignore here.
    }
  }, [reconnect]);

  // Guard quick triggers against double taps while a request is in flight.
  const [busyTriggers, setBusyTriggers] = useState<ReadonlySet<string>>(new Set());
  const handleTrigger = useCallback(
    async (name: string) => {
      if (busyTriggers.has(name)) return;
      setBusyTriggers((prev) => new Set(prev).add(name));
      try {
        await triggerSubworker(name);
      } catch {
        // Surfaced through lastError by the store.
      } finally {
        setBusyTriggers((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [busyTriggers, triggerSubworker],
  );

  const runningAgents = useMemo(
    () => subworkers.filter((w) => w.running),
    [subworkers],
  );
  const idleAgents = useMemo(
    () =>
      subworkers.filter((w) => w.enabled && !w.running).slice(0, MAX_QUICK_TRIGGERS),
    [subworkers],
  );
  const enabledCount = useMemo(
    () => subworkers.filter((w) => w.enabled).length,
    [subworkers],
  );

  const meta = connectionMeta(connectionState);
  const toneColor =
    meta.tone === 'accent'
      ? theme.colors.accent
      : meta.tone === 'error'
        ? theme.stateColors.error
        : theme.stateColors.idle;
  const needsReconnect =
    connectionState === 'disconnected' || connectionState === 'error';
  const hasData = subworkers.length > 0;
  // Initial fetch in flight — show placeholders instead of misleading zeros.
  const booting = isLoading && !hasData;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.accent}
          colors={[theme.colors.accent]}
          progressBackgroundColor={theme.colors.surface}
        />
      }
    >
      {visibleError ? (
        <ErrorBanner
          message={visibleError}
          onDismiss={() => setDismissedError(visibleError)}
        />
      ) : null}

      {/* Connection ------------------------------------------------------- */}
      <StatusCard
        title="Connection"
        accessory={<View style={[styles.dot, { backgroundColor: toneColor }]} />}
      >
        <View style={styles.connRow}>
          <Text style={[theme.type.headline, styles.connLabel]}>{meta.label}</Text>
          {connectionState === 'connecting' ? (
            <ActivityIndicator size="small" color={toneColor} />
          ) : null}
        </View>
        <Text style={[theme.type.caption, styles.connUrl]} numberOfLines={1}>
          {serverUrl}
        </Text>
        {needsReconnect ? (
          <Pressable
            onPress={handleReconnect}
            accessibilityRole="button"
            accessibilityLabel="Reconnect to server"
            style={({ pressed }) => [styles.reconnectBtn, pressed && styles.pressed]}
          >
            <Text style={[theme.type.caption, styles.reconnectText]}>Reconnect</Text>
          </Pressable>
        ) : null}
      </StatusCard>

      {/* Counters row ----------------------------------------------------- */}
      {hasData || booting ? (
        <View style={styles.counterRow}>
          {booting ? (
            <>
              <CounterSkeleton />
              <CounterSkeleton />
            </>
          ) : (
            <>
              <Pressable
                onPress={() => router.push('/agents')}
                accessibilityRole="button"
                accessibilityLabel="See running agents"
                style={({ pressed }) => [
                  styles.tile,
                  runningAgents.length > 0 && styles.tileAccent,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    theme.type.largeTitle,
                    {
                      color:
                        runningAgents.length > 0
                          ? theme.colors.accent
                          : theme.colors.textPrimary,
                    },
                  ]}
                >
                  {runningAgents.length}
                </Text>
                <Text style={[theme.type.caption, styles.tileLabel]}>running</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push('/agents')}
                accessibilityRole="button"
                accessibilityLabel="See enabled agents"
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                <Text style={[theme.type.largeTitle, styles.tileValueNeutral]}>
                  {enabledCount}
                </Text>
                <Text style={[theme.type.caption, styles.tileLabel]}>enabled</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {/* Server health ---------------------------------------------------- */}
      <StatusCard title="Server health">
        {serverHealth ? (
          <View style={styles.healthGrid}>
            <HealthCell label="State" value={serverHealth.state} />
            <HealthCell label="Health" value={serverHealth.healthStatus} />
            <HealthCell
              label="PID"
              value={serverHealth.pid != null ? String(serverHealth.pid) : '—'}
            />
            <HealthCell label="Restarts" value={String(serverHealth.restartCount)} />
          </View>
        ) : (
          <View style={styles.healthGrid}>
            <SkeletonCell />
            <SkeletonCell />
            <SkeletonCell />
            <SkeletonCell />
          </View>
        )}
      </StatusCard>

      {/* Recent chats ------------------------------------------------------ */}
      <RecentChatsCard refreshKey={chatRefreshTick} />

      {/* Quick actions / empty state -------------------------------------- */}
      {hasData ? (
        <StatusCard title="Quick actions">
          {runningAgents.length > 0 ? (
            <View>
              <Text style={[theme.type.caption, styles.groupCaption]}>Running</Text>
              <View>
                {runningAgents.map((w, i) => (
                  <Pressable
                    key={w.id}
                    onPress={() => router.push(`/agent/${encodeURIComponent(w.name)}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${w.name}`}
                    style={({ pressed }) => [
                      styles.runningRow,
                      i > 0 && styles.rowDivider,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[styles.avatar, { backgroundColor: withAlpha(theme.stateColors.running, 0.14) }]}
                    >
                      <Text
                        style={[styles.avatarText, { color: theme.stateColors.running }]}
                      >
                        {monogram(w.name)}
                      </Text>
                    </View>
                    <Text style={[theme.type.body, styles.runningName]} numberOfLines={1}>
                      {w.name}
                    </Text>
                    <View
                      style={[styles.dotSm, { backgroundColor: theme.stateColors.running }]}
                    />
                    <Text style={[theme.type.body, styles.chevron]}>›</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {idleAgents.length > 0 ? (
            <View>
              {runningAgents.length > 0 ? <View style={styles.blockDivider} /> : null}
              <Text style={[theme.type.caption, styles.groupCaption]}>Trigger now</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {idleAgents.map((w) => {
                  const busy = busyTriggers.has(w.name);
                  return (
                    <Pressable
                      key={w.id}
                      onPress={() => handleTrigger(w.name)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Trigger ${w.name}`}
                      style={({ pressed }) => [
                        styles.chip,
                        busy && styles.chipBusy,
                        pressed && styles.pressed,
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={theme.colors.accent} />
                      ) : (
                        <Text style={styles.chipBolt}>⚡</Text>
                      )}
                      <Text style={[theme.type.caption, styles.chipText]} numberOfLines={1}>
                        {w.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => router.push('/agents')}
                  accessibilityRole="button"
                  accessibilityLabel="See all agents"
                  style={({ pressed }) => [
                    styles.chip,
                    styles.chipGhost,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[theme.type.caption, styles.chipGhostText]}>See all ›</Text>
                </Pressable>
              </ScrollView>
            </View>
          ) : null}

          {runningAgents.length === 0 && idleAgents.length === 0 ? (
            <Text style={[theme.type.caption, styles.fallbackNote]}>
              No agents available to trigger right now.
            </Text>
          ) : null}
        </StatusCard>
      ) : !booting ? (
        <View style={styles.emptyBlock}>
          <View style={styles.emptyDots}>
            <View style={styles.emptyDot} />
            <View style={styles.emptyDot} />
            <View style={styles.emptyDot} />
          </View>
          <Text style={[theme.type.headline, styles.emptyTitle]}>No agents yet</Text>
          <Text style={[theme.type.caption, styles.emptyCaption]}>
            {needsReconnect || connectionState === 'connecting'
              ? 'Connect to your Elia server to see your agents here.'
              : 'Your Elia server is connected but reports no subworkers.'}
          </Text>
          {needsReconnect ? (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              style={({ pressed }) => [
                styles.chipGhost,
                styles.emptyCta,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[theme.type.caption, styles.chipGhostText]}>
                Open Settings
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                               */
/* -------------------------------------------------------------------------- */

function HealthCell({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={cellStyles.cell}>
      <Text style={[theme.type.caption, { color: theme.colors.textTertiary }]}>
        {label}
      </Text>
      <Text
        style={[theme.type.body, { color: theme.colors.textPrimary, fontWeight: '600' }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function SkeletonCell() {
  const theme = useTheme();
  const fill = withAlpha(theme.colors.textTertiary, 0.28);
  return (
    <View style={cellStyles.cell}>
      <View style={[cellStyles.barShort, { backgroundColor: fill }]} />
      <View style={[cellStyles.barLong, { backgroundColor: fill }]} />
    </View>
  );
}

function CounterSkeleton() {
  const theme = useTheme();
  const fill = withAlpha(theme.colors.textTertiary, 0.24);
  return (
    <View style={[counterStyles.tile]}>
      <View style={[counterStyles.barWide, { backgroundColor: fill }]} />
      <View style={[counterStyles.barNarrow, { backgroundColor: fill }]} />
    </View>
  );
}

const counterStyles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 22,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  barWide: { height: 26, width: '34%', borderRadius: 8 },
  barNarrow: { height: 11, width: '48%', borderRadius: 6 },
});

// Shared static layout for health cells/skeletons (colors applied inline).
const cellStyles = StyleSheet.create({
  cell: { flexBasis: '47%', gap: 2 },
  barShort: { height: 10, width: '42%', borderRadius: 5 },
  barLong: { height: 13, width: '68%', borderRadius: 7 },
});

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 14 },
    pressed: { opacity: 0.6 },

    // Connection
    connRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    connLabel: { color: colors.textPrimary },
    connUrl: { color: colors.textTertiary },
    reconnectBtn: {
      alignSelf: 'flex-start',
      marginTop: 2,
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    reconnectText: { color: colors.accent, fontWeight: '600' },

    dot: { width: 10, height: 10, borderRadius: 5 },

    // Counters
    counterRow: { flexDirection: 'row', gap: 12 },
    tile: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
      paddingVertical: 18,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    tileAccent: {
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderColor: withAlpha(colors.accent, 0.25),
    },
    tileValueNeutral: { color: colors.textPrimary },
    tileLabel: { color: colors.textSecondary },

    // Server health
    healthGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 12,
    },

    // Quick actions
    groupCaption: { color: colors.textTertiary, marginBottom: 6 },
    runningRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontSize: 12, fontWeight: '700' },
    dotSm: { width: 8, height: 8, borderRadius: 4 },
    runningName: { flex: 1, color: colors.textPrimary, fontWeight: '600' },
    chevron: { color: colors.textTertiary, fontWeight: '600' },
    blockDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginBottom: 12,
    },
    chipRow: { gap: 8, paddingRight: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 220,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    chipBusy: { opacity: 0.7 },
    chipBolt: { fontSize: 12 },
    chipText: { color: colors.textPrimary, fontWeight: '600' },
    chipGhost: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipGhostText: { color: colors.textSecondary, fontWeight: '600' },
    fallbackNote: { color: colors.textTertiary },

    // Empty state
    emptyBlock: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 40,
      paddingHorizontal: 24,
    },
    emptyDots: { flexDirection: 'row', gap: 6, marginBottom: 6 },
    emptyDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.textTertiary,
    },
    emptyTitle: { color: colors.textPrimary },
    emptyCaption: {
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    emptyCta: {
      marginTop: 10,
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 999,
    },
  });
