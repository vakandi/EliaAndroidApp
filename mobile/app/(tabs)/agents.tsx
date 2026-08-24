/**
 * Agents tab — live subworker list (PLAN.md §3).
 * Sorted running → idle → done → disabled → error. Pull-to-refresh,
 * per-row quick trigger, loading / empty / error states.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AgentRow, STATE_ORDER, deriveAgentState } from '@/src/components/AgentRow';
import { useSubworkersStore } from '@/src/lib/store';
import type { SubworkerInfo } from '@/src/lib/types';
import { useTheme, type Theme } from '@/src/theme';

export default function AgentsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const subworkers = useSubworkersStore((s) => s.subworkers);
  const isLoading = useSubworkersStore((s) => s.isLoading);
  const statusError = useSubworkersStore((s) => s.statusError);
  const refreshNow = useSubworkersStore((s) => s.refreshNow);
  const triggerSubworker = useSubworkersStore((s) => s.triggerSubworker);

  const [refreshing, setRefreshing] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...subworkers].sort(
        (a, b) =>
          STATE_ORDER[deriveAgentState(a)] - STATE_ORDER[deriveAgentState(b)] ||
          a.name.localeCompare(b.name),
      ),
    [subworkers],
  );

  const runningCount = subworkers.filter((sw) => sw.running && sw.enabled).length;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshNow();
    } catch {
      // Store surfaces connection issues through statusError.
    } finally {
      setRefreshing(false);
    }
  }, [refreshNow]);

  const handleTrigger = useCallback(
    async (name: string) => {
      if (pendingName) return;
      setPendingName(name);
      try {
        await triggerSubworker(name);
      } catch {
        // Trigger failures surface via store error state.
      } finally {
        setPendingName(null);
      }
    },
    [pendingName, triggerSubworker],
  );

  const openDetail = useCallback(
    (name: string) => {
      router.push({ pathname: '/agent/[name]', params: { name } });
    },
    [router],
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={sorted}
        keyExtractor={(item: SubworkerInfo) => item.id || item.name}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => (
          <AgentRow
            subworker={item}
            triggerPending={pendingName === item.name}
            onPress={() => openDetail(item.name)}
            onTrigger={() => void handleTrigger(item.name)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[theme.type.largeTitle, styles.textPrimary]}>Agents</Text>
            <Text style={styles.subtitle}>
              {subworkers.length} agent{subworkers.length === 1 ? '' : 's'} · {runningCount} running
            </Text>
            {statusError != null && (
              <View style={styles.errorBanner}>
                <View style={styles.errorDot} />
                <Text style={styles.errorBannerText} numberOfLines={3}>
                  {statusError}
                </Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={styles.stateTitle}>Connecting to server…</Text>
              <Text style={styles.stateCaption}>Fetching your subworkers.</Text>
            </View>
          ) : (
            <View style={styles.stateWrap}>
              <View style={[styles.emptyAvatar, { backgroundColor: `${theme.colors.accent}14` }]}>
                <Text style={[styles.emptyGlyph, { color: theme.colors.accent }]}>◇</Text>
              </View>
              <Text style={styles.stateTitle}>No subworkers found — check Settings</Text>
              <Text style={styles.stateCaption}>
                Verify the server URL and make sure EliaAgent is running on your network.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

function Separator() {
  const theme = useTheme();
  return <View style={{ height: theme.spacing.sm }} />;
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    header: {
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.lg,
    },
    textPrimary: {
      color: theme.colors.textPrimary,
    },
    subtitle: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      marginBottom: theme.spacing.sm,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
      backgroundColor: 'rgba(239, 68, 68, 0.10)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(239, 68, 68, 0.35)',
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
    },
    errorDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.stateColors.error,
    },
    errorBannerText: {
      ...theme.type.caption,
      flex: 1,
      color: theme.stateColors.error,
    },
    stateWrap: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xxl * 2,
      paddingHorizontal: theme.spacing.xl,
    },
    emptyAvatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.xs,
    },
    emptyGlyph: {
      fontSize: 24,
      fontWeight: '600',
    },
    stateTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
      textAlign: 'center',
    },
    stateCaption: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      maxWidth: 280,
    },
  });
