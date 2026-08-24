/**
 * RecentChatsCard — Home tab "Chat" section (PLAN.md §3).
 *
 * Lists the 5 most recent chat sessions across ALL agents:
 * - one getSessionsList call per subworker, in parallel; individual
 *   failures are tolerated silently (partial lists still render)
 * - merged + sorted by timeCreated desc, capped at 5 rows
 * - each row lazily fetches its last 5 messages to surface the latest
 *   AI reply's timestamp ("AI · 12s ago"); failures hide that caption
 * - tap a row → deep-links into the agent screen with the session open
 *
 * Renders nothing (no empty card) when there are no sessions at all.
 * Re-fetches on screen focus and when the parent bumps `refreshKey`
 * (wired to the Home screen's pull-to-refresh).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Avatar } from '@/src/components/Avatar';
import { StatusCard } from '@/src/components/StatusCard';
import { SubworkerApi } from '@/src/lib/api';
import type { SessionSummary } from '@/src/lib/session-types';
import { useSettingsStore } from '@/src/lib/settings';
import { useSubworkersStore } from '@/src/lib/store';
import { useTheme, type Theme } from '@/src/theme';

/** Row cap for the Home "Chat" section (PLAN §3). */
const MAX_RECENT_SESSIONS = 5;

interface RecentChatsCardProps {
  /** Bump to force a refetch — wired to the Home screen's pull-to-refresh. */
  refreshKey?: number;
}

interface RecentChat {
  agentName: string;
  sessionId: string;
  title: string | null;
  timeCreated: number | null;
}

export function RecentChatsCard({ refreshKey = 0 }: RecentChatsCardProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const subworkers = useSubworkersStore((s) => s.subworkers);
  const serverUrl = useSettingsStore((s) => s.serverUrl);

  const [chats, setChats] = useState<RecentChat[] | null>(null);
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const names = subworkers.map((w) => w.name);
    if (names.length === 0) {
      setChats([]);
      return;
    }

    const id = ++loadIdRef.current;
    const api = new SubworkerApi(
      () => serverUrl,
      () => useSettingsStore.getState().authToken,
    );

    // Parallel per-agent fetch; a failing agent just contributes no rows.
    const settled = await Promise.allSettled(
      names.map((name) => api.getSessionsList(name)),
    );
    if (loadIdRef.current !== id) return; // a newer load superseded this one

    const seen = new Set<string>();
    const merged: RecentChat[] = [];
    settled.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const agentName = names[i];
      for (const session of result.value) {
        mergeSession(merged, seen, agentName, session);
      }
    });
    // Null timestamps sort last but stay visible.
    merged.sort((a, b) => (b.timeCreated ?? 0) - (a.timeCreated ?? 0));
    setChats(merged.slice(0, MAX_RECENT_SESSIONS));
  }, [subworkers, serverUrl]);

  // Fresh list every time the Home tab regains focus (also covers mount).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Pull-to-refresh on the Home screen bumps refreshKey → refetch here too.
  useEffect(() => {
    if (refreshKey > 0) void load();
  }, [refreshKey, load]);

  const openChat = useCallback(
    (chat: RecentChat) => {
      router.push(
        `/agent/${encodeURIComponent(chat.agentName)}?chats=1&session=${chat.sessionId}`,
      );
    },
    [router],
  );

  // No data yet (initial load) or genuinely no sessions → section disappears.
  if (chats === null || chats.length === 0) return null;

  return (
    <StatusCard title="Chat">
      <View>
        {chats.map((chat, i) => (
          <ChatRow
            key={`${chat.agentName}:${chat.sessionId}`}
            chat={chat}
            showDivider={i > 0}
            onPress={() => openChat(chat)}
          />
        ))}
      </View>
    </StatusCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                               */
/* -------------------------------------------------------------------------- */

function mergeSession(
  merged: RecentChat[],
  seen: Set<string>,
  agentName: string,
  session: SessionSummary,
): void {
  const key = `${agentName}:${session.sessionId}`;
  if (seen.has(key)) return;
  seen.add(key);
  merged.push({
    agentName,
    sessionId: session.sessionId,
    title: session.title,
    timeCreated: session.timeCreated,
  });
}

/**
 * One chat row. Lazily resolves the latest AI message timestamp from the
 * row's last 5 messages; any failure simply leaves the caption hidden.
 */
function ChatRow({
  chat,
  showDivider,
  onPress,
}: {
  chat: RecentChat;
  showDivider: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const serverUrl = useSettingsStore((s) => s.serverUrl);

  const [aiTime, setAiTime] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = new SubworkerApi(
      () => serverUrl,
      () => useSettingsStore.getState().authToken,
    );
    api
      .getSessionMessages(chat.agentName, chat.sessionId, 5)
      .then((messages) => {
        if (cancelled) return;
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info;
          if (info.role === 'assistant' && info.timeCreated != null) {
            setAiTime(info.timeCreated);
            return;
          }
        }
      })
      .catch(() => {
        // Tolerated by design — the "AI · …" caption stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [chat.agentName, chat.sessionId, serverUrl]);

  const createdLabel = formatRelativeTime(chat.timeCreated);
  const metaLine = createdLabel
    ? `${chat.agentName} · ${createdLabel}`
    : chat.agentName;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open chat ${chat.title ?? 'Untitled'} with ${chat.agentName}`}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && styles.pressed,
      ]}
    >
      <Avatar name={chat.agentName} size={38} />
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {chat.title ?? 'Untitled'}
        </Text>
        <Text style={styles.metaLine} numberOfLines={1}>
          {metaLine}
        </Text>
        {aiTime != null ? (
          <Text style={styles.aiLine} numberOfLines={1}>
            AI · {formatRelativeTime(aiTime)}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

/** Epoch-ms → human relative time ("12s ago", "2 min ago", "3h ago", "Aug 12"). */
function formatRelativeTime(epochMs: number | null): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '';
  const diffMs = Date.now() - epochMs;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const monthsShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const date = new Date(epochMs);
  return `${monthsShort[date.getMonth()]} ${date.getDate()}`;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pressed: { opacity: 0.6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    textBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      ...theme.type.body,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    metaLine: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
    },
    aiLine: {
      ...theme.type.caption,
      color: theme.colors.accent,
    },
    chevron: {
      ...theme.type.body,
      color: theme.colors.textTertiary,
      fontWeight: '600',
    },
  });
