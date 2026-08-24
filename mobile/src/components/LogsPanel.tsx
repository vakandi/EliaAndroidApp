/**
 * LogsPanel — live log viewer for one subworker (PLAN.md §3).
 * Fetches `/logs/{name}?lines=50` via the store, with an auto-refresh
 * toggle (2s cadence), a monospace console surface and clipboard copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { LOG_REFRESH_MS } from '@/src/lib/config';
import { useSubworkersStore } from '@/src/lib/store';
import { useTheme, type Theme } from '@/src/theme';

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });
const MAX_LOG_HEIGHT = 280;

interface LogsPanelProps {
  name: string;
}

export function LogsPanel({ name }: LogsPanelProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const fetchLogs = useSubworkersStore((s) => s.fetchLogs);

  const [lines, setLines] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);

  const inFlight = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchLogs(name, 50);
      setLines(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [fetchLogs, name]);

  // Initial load + reload when the target agent changes.
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Auto-refresh cadence — cleaned up on unmount / toggle-off.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void load();
    }, LOG_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const handleCopy = () => {
    if (!lines || lines.length === 0) return;
    try {
      Clipboard.setString(lines.join('\n'));
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable on this platform — silently omit.
    }
  };

  return (
    <View style={styles.wrap}>
      {/* Section header */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Logs</Text>
        <View style={styles.headerControls}>
          <Text style={styles.autoLabel}>Auto</Text>
          <Switch
            value={autoRefresh}
            onValueChange={setAutoRefresh}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            thumbColor="#FFFFFF"
            style={styles.switch}
            accessibilityLabel="Auto-refresh logs every 2 seconds"
          />
          <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Refresh logs now">
            <Text style={styles.iconBtn}>↻</Text>
          </Pressable>
          {!!lines?.length && (
            <Pressable onPress={handleCopy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy logs to clipboard">
              <Text style={[styles.copyBtn, copied && styles.copiedBtn]}>
                {copied ? 'Copied ✓' : 'Copy'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Console surface */}
      <View style={styles.console}>
        {loading && lines == null ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.stateText}>Loading logs…</Text>
          </View>
        ) : error != null ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText} numberOfLines={3}>
              Couldn’t load logs — {error}
            </Text>
            <Pressable style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]} onPress={() => void load()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (lines ?? []).length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>No log output yet for this agent.</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {(lines ?? []).map((line, i) => (
              <Text key={`${i}-${line.slice(0, 12)}`} style={styles.line}>
                {line === '' ? ' ' : line}
              </Text>
            ))}
          </ScrollView>
        )}
      </View>

      {!loading && error == null && lines != null && (
        <Text style={styles.footerCaption}>{lines.length} recent lines · refreshed every {LOG_REFRESH_MS / 1000}s when Auto is on</Text>
      )}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: {
      gap: theme.spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
      flex: 1,
    },
    headerControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    autoLabel: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
    },
    switch: {
      transform: [{ scale: 0.8 }],
    },
    iconBtn: {
      fontSize: 18,
      color: theme.colors.textSecondary,
      paddingHorizontal: theme.spacing.xs,
    },
    copyBtn: {
      ...theme.type.caption,
      fontWeight: '600',
      color: theme.colors.accent,
      paddingHorizontal: theme.spacing.xs,
    },
    copiedBtn: {
      opacity: 0.6,
    },
    console: {
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      maxHeight: MAX_LOG_HEIGHT,
      overflow: 'hidden',
    },
    scroll: {
      padding: theme.spacing.md,
    },
    line: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.textSecondary,
    },
    centerState: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.xxl,
      paddingHorizontal: theme.spacing.lg,
    },
    stateText: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
    },
    errorText: {
      ...theme.type.caption,
      color: theme.stateColors.error,
      textAlign: 'center',
    },
    retryBtn: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${theme.colors.accent}66`,
      backgroundColor: `${theme.colors.accent}14`,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: 6,
    },
    retryPressed: {
      opacity: 0.7,
    },
    retryText: {
      ...theme.type.caption,
      fontWeight: '600',
      color: theme.colors.accent,
    },
    footerCaption: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textTertiary,
    },
  });
