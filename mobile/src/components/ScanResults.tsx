/**
 * LAN discovery panel (PLAN.md §4) — Unit F.
 * Owns the full scan lifecycle: start (optionally automatic on mount),
 * progressive result feed, cancellation-safe teardown on unmount, and
 * pick-to-connect (save URL + reconnect + inline confirmation).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DEFAULT_PORT } from '@/src/lib/config';
import { abortScan, scanLocalNetwork } from '@/src/lib/discovery';
import { useSettingsStore } from '@/src/lib/settings';
import { useSubworkersStore } from '@/src/lib/store';
import type { DiscoveredServer, ScanError } from '@/src/lib/types';
import { radius, spacing, useTheme } from '@/src/theme';

type ScanPhase = 'idle' | 'scanning' | 'done';

type ThemeType = ReturnType<typeof useTheme>;

interface ScanResultsProps {
  /** Begin scanning immediately on mount (Settings expands → one-tap scan). */
  autoStart?: boolean;
}

/** Port embedded in the saved server URL, else the default EliaAgent port. */
function portFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port, 10);
    if (Number.isInteger(port)) return port;
  } catch {
    // Malformed saved URL — fall through to the default port.
  }
  return DEFAULT_PORT;
}

const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type ScanStyles = ReturnType<typeof makeStyles>;

export default function ScanResults({ autoStart = false }: ScanResultsProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const reconnect = useSubworkersStore((s) => s.reconnect);

  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [scanError, setScanError] = useState<ScanError | null>(null);
  const [pickedIp, setPickedIp] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  // Unmount mid-scan must stop all probes (PLAN.md §4.7 cancellation safety).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortScan(); // No-op when nothing is running.
      if (pickTimerRef.current) clearTimeout(pickTimerRef.current);
    };
  }, []);

  const startScan = useCallback(() => {
    setPickedIp(null);
    setScanError(null);
    setFound([]);
    setPhase('scanning');

    void scanLocalNetwork(
      portFromUrl(serverUrlRef.current),
      (server) => {
        if (!mountedRef.current) return;
        setFound((prev) => [...prev, server]);
      },
      useSettingsStore.getState().authToken,
    ).then((result) => {
      if (!mountedRef.current) return;
      setFound(result.servers);
      setScanError(result.error);
      setPhase('done');
    });
  }, []);

  useEffect(() => {
    if (autoStart) startScan();
  }, [autoStart, startScan]);

  const pickServer = (server: DiscoveredServer): void => {
    setServerUrl(server.baseUrl);
    try {
      reconnect();
    } catch (error) {
      // Connection core lands independently (Unit B); never crash the UI here.
      console.warn('[ScanResults] reconnect unavailable:', error);
    }
    setPickedIp(server.ip);
    if (pickTimerRef.current) clearTimeout(pickTimerRef.current);
    pickTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setPickedIp(null);
    }, 2600);
  };

  // Live-sorted so the fastest responder surfaces as soon as it answers.
  const visibleServers = [...found].sort((a, b) => a.latencyMs - b.latencyMs);

  return (
    <View style={styles.container}>
      {phase === 'scanning' ? (
        <ScanningBody styles={styles} theme={theme} count={found.length} />
      ) : (
        <DoneBody
          styles={styles}
          phase={phase}
          servers={visibleServers}
          error={scanError}
          pickedIp={pickedIp}
          onPick={pickServer}
          onRescan={startScan}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Scanning state
// ---------------------------------------------------------------------------

interface ScanningBodyProps {
  styles: ScanStyles;
  theme: ReturnType<typeof useTheme>;
  count: number;
}

function ScanningBody({ styles, theme, count }: ScanningBodyProps) {
  return (
    <View style={styles.stack}>
      <IndeterminateBar trackColor={theme.colors.border} barColor={theme.colors.accent} />
      <View style={styles.counterRow}>
        <Text style={[styles.caption, { color: theme.colors.textSecondary }]}>
          Probing…{' '}
          <Text style={[styles.captionStrong, { color: theme.colors.accent }]}>
            {count} found
          </Text>
        </Text>
        <Pressable
          onPress={() => abortScan()}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel="Cancel the network scan"
        >
          <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Slim indeterminate sweep bar — measured so the slide fits any width. */
function IndeterminateBar({ trackColor, barColor }: { trackColor: string; barColor: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const barWidth = Math.max(trackWidth * 0.35, 24);
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-barWidth, trackWidth],
  });

  return (
    <View
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[barStyles.track, { backgroundColor: trackColor }]}
    >
      {trackWidth > 0 && (
        <Animated.View style={{ width: barWidth, transform: [{ translateX }] }}>
          <View style={[barStyles.bar, { backgroundColor: barColor }]} />
        </Animated.View>
      )}
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  bar: {
    height: 4,
    borderRadius: 999,
  },
});

// ---------------------------------------------------------------------------
// Idle / done states
// ---------------------------------------------------------------------------

interface DoneBodyProps {
  styles: ScanStyles;
  phase: Exclude<ScanPhase, 'scanning'>;
  servers: DiscoveredServer[];
  error: ScanError | null;
  pickedIp: string | null;
  onPick: (server: DiscoveredServer) => void;
  onRescan: () => void;
}

function DoneBody({
  styles,
  phase,
  servers,
  error,
  pickedIp,
  onPick,
  onRescan,
}: DoneBodyProps) {
  const theme = useTheme();

  // --- Entry state (rendered without autoStart) -------------------------------
  if (phase === 'idle') {
    return (
      <View style={styles.stack}>
        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
          Searches your Wi-Fi for a running EliaAgent server.
        </Text>
        <PrimaryButton styles={styles} label="Scan network" onPress={onRescan} />
      </View>
    );
  }

  // --- Not on Wi-Fi ---------------------------------------------------------
  if (error === 'not_on_wifi') {
    return (
      <View style={styles.stack}>
        <HintBlock styles={styles} tone="warning" title="Not on Wi-Fi">
          Connect your phone to the same network as the server, then scan again.
        </HintBlock>
        <PrimaryButton styles={styles} label="Try again" onPress={onRescan} />
      </View>
    );
  }

  // --- Cancelled, nothing found ----------------------------------------------
  if (error === 'aborted' && servers.length === 0) {
    return (
      <View style={styles.stack}>
        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>Scan cancelled.</Text>
        <PrimaryButton styles={styles} label="Scan again" onPress={onRescan} />
      </View>
    );
  }

  // --- Clean finish, nothing found --------------------------------------------
  if (servers.length === 0 && error === null && phase === 'done') {
    return (
      <View style={styles.stack}>
        <HintBlock styles={styles} tone="neutral" title="No server found">
          Make sure the EliaAgent server is running and both devices are on the same Wi-Fi.
        </HintBlock>
        <PrimaryButton styles={styles} label="Scan again" onPress={onRescan} />
      </View>
    );
  }

  // --- Results ------------------------------------------------------------------
  return (
    <View style={styles.stack}>
      {error === 'aborted' ? (
        <Text style={[styles.caption, { color: theme.colors.textTertiary }]}>
          Scan cancelled — showing {servers.length} found before stopping.
        </Text>
      ) : (
        <Text style={[styles.caption, { color: theme.colors.textTertiary }]}>
          {servers.length} found · tap to connect
        </Text>
      )}

      <View>
        {servers.map((server, index) => (
          <ServerRow
            key={`${server.ip}:${server.port}`}
            styles={styles}
            theme={theme}
            server={server}
            isPicked={pickedIp === server.ip}
            showSeparator={index > 0}
            onPress={() => onPick(server)}
          />
        ))}
      </View>

      <Pressable
        onPress={onRescan}
        accessibilityRole="button"
        accessibilityLabel="Run the network scan again"
        style={({ pressed }) => [
          styles.rescanButton,
          pressed && styles.pressedSoft,
        ]}
      >
        <Text style={[styles.actionText, { color: theme.colors.accent }]}>Scan again</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface ServerRowProps {
  styles: ScanStyles;
  theme: ReturnType<typeof useTheme>;
  server: DiscoveredServer;
  isPicked: boolean;
  showSeparator: boolean;
  onPress: () => void;
}

function ServerRow({ styles, theme, server, isPicked, showSeparator, onPress }: ServerRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Connect to server at ${server.baseUrl}, ${server.latencyMs} milliseconds`}
      style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
    >
      <View style={styles.rowLeft}>
        <Text style={[styles.ipText, { color: theme.colors.textPrimary }]}>{server.ip}</Text>
        <Text style={[styles.portText, { color: theme.colors.textTertiary }]}>
          :{server.port}
        </Text>
      </View>

      <View style={styles.rowRight}>
        {isPicked ? (
          <Text style={[styles.savedText, { color: theme.colors.accent }]}>
            ✓ Saved — connecting
          </Text>
        ) : (
          <>
            <Text style={[styles.caption, { color: theme.colors.textTertiary }]}>
              {server.latencyMs} ms
            </Text>
            {server.verified ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                <Text style={styles.badgeGlyph}>✓</Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeMuted]}>
                <Text style={[styles.badgeGlyph, styles.badgeGlyphMuted]}>·</Text>
              </View>
            )}
          </>
        )}
      </View>

      {showSeparator && (
        <View
          pointerEvents="none"
          style={[
            styles.rowSeparator,
            { backgroundColor: theme.colors.border },
          ]}
        />
      )}
    </Pressable>
  );
}

interface HintBlockProps {
  styles: ScanStyles;
  tone: 'neutral' | 'warning';
  title: string;
  children: string;
}

function HintBlock({ styles, tone, title, children }: HintBlockProps) {
  const theme = useTheme();
  const accentColor =
    tone === 'warning' ? theme.stateColors.error : theme.colors.textTertiary;

  return (
    <View style={styles.hintBlock}>
      <View style={[styles.hintBadge, { borderColor: accentColor }]}>
        <Text style={[styles.hintBadgeGlyph, { color: accentColor }]}>!</Text>
      </View>
      <View style={styles.hintCopy}>
        <Text style={[styles.headline, { color: theme.colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.caption, { color: theme.colors.textSecondary }]}>{children}</Text>
      </View>
    </View>
  );
}

interface PrimaryButtonProps {
  styles: ScanStyles;
  label: string;
  onPress: () => void;
}

function PrimaryButton({ styles, label, onPress }: PrimaryButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.colors.accent },
        pressed && styles.pressedStrong,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (theme: ThemeType) =>
  StyleSheet.create({
    container: {
      alignSelf: 'stretch',
    },
    stack: {
      gap: spacing.md,
    },

    // Scanning
    counterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 32,
    },

    // Result rows
    row: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm + 1,
      borderRadius: radius.sm - 4,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexShrink: 1,
    },
    ipText: {
      fontSize: 15,
      fontWeight: '600',
      fontFamily: monoFont,
    },
    portText: {
      fontSize: 13,
      fontFamily: monoFont,
    },
    rowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
    },
    rowSeparator: {
      position: 'absolute',
      left: spacing.lg,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
    },
    badge: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeMuted: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    badgeGlyph: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 13,
    },
    badgeGlyphMuted: {
      fontWeight: '400',
    },
    savedText: {
      fontSize: 13,
      fontWeight: '600',
    },

    // Hints
    hintBlock: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    hintBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    hintBadgeGlyph: {
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 16,
    },
    hintCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    headline: {
      fontSize: 15,
      fontWeight: '600',
    },

    // Shared text styles
    body: {
      fontSize: 15,
      fontWeight: '400',
    },
    caption: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '400',
    },
    captionStrong: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    actionText: {
      fontSize: 14,
      fontWeight: '600',
    },

    // Buttons
    primaryButton: {
      alignSelf: 'flex-start',
      minHeight: 40,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    rescanButton: {
      alignSelf: 'flex-start',
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
    pressedSoft: {
      opacity: 0.55,
    },
    pressedStrong: {
      opacity: 0.8,
    },
  });
