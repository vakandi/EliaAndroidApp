/**
 * SessionsModal — per-agent conversation picker (PLAN.md §8-I).
 *
 * Full-screen modal opened from the agent detail screen's "Chats" entry:
 * - lists sessions from SubworkerApi.getSessionsList (title + relative time)
 * - tap a row → ChatViewer takes over inside the same modal
 * - back from a conversation returns here so switching sessions is one tap
 * - pull-to-refresh + manual refresh
 *
 * All colors/spacing/type come from useTheme tokens only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubworkerApi } from '@/src/lib/api';
import type { SessionSummary } from '@/src/lib/session-types';
import { useSettingsStore } from '@/src/lib/settings';
import { ChatViewer } from '@/src/components/ChatViewer';
import { PromptModal } from '@/src/components/PromptModal';
import { useTheme, type Theme } from '@/src/theme';

interface SessionsModalProps {
  visible: boolean;
  agentName: string;
  onClose: () => void;
  /** Deep-link session auto-opened once per modal open (ChatViewer preloaded). */
  initialSessionId?: string | null;
}

interface SelectedSession {
  sessionId: string;
  title: string | null;
}

export function SessionsModal({ visible, agentName, onClose, initialSessionId }: SessionsModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme, insets.bottom);
  const serverUrl = useSettingsStore((s) => s.serverUrl);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedSession | null>(null);
  const deepLinkConsumed = useRef(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'pull') => {
      if (!agentName) return;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      try {
        const api = new SubworkerApi(
          () => serverUrl,
          () => useSettingsStore.getState().authToken,
        );
        const list = await api.getSessionsList(agentName);
        setSessions(list);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [agentName, serverUrl],
  );

  // Fresh list every time the modal opens or the agent changes.
  useEffect(() => {
    if (!visible || !agentName) return;
    setSelected(null);
    setSessions(null);
    setError(null);
    deepLinkConsumed.current = false;
    void load('initial');
  }, [visible, agentName, load]);

  // Deep link: auto-open the requested session once the list resolves.
  useEffect(() => {
    if (!visible || !initialSessionId || sessions == null || deepLinkConsumed.current) return;
    deepLinkConsumed.current = true;
    const match = sessions.find((s) => s.sessionId === initialSessionId);
    setSelected({ sessionId: initialSessionId, title: match?.title ?? null });
  }, [visible, initialSessionId, sessions]);

  const handlePromptTriggered = useCallback(
    (_agent: string, sid: string) => {
      setPromptOpen(false);
      setSelected({ sessionId: sid, title: null });
      void load('pull');
    },
    [load],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={selected ? () => setSelected(null) : onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={selected ? 'Back to conversations' : 'Close conversations'}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selected && selected.title?.trim() ? selected.title : agentName || 'Agent'}
            </Text>
            <Text style={styles.headerCaption}>
              {selected
                ? 'Conversation'
                : `Conversations${sessions ? ` · ${sessions.length}` : ''}`}
            </Text>
          </View>
          {!selected && (
            <>
              <Pressable
                onPress={() => setPromptOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Start a new session with a prompt"
              >
                <Text style={styles.iconBtn}>＋</Text>
              </Pressable>
              <Pressable
                onPress={() => void load('pull')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Refresh conversation list"
              >
                <Text style={styles.iconBtn}>↻</Text>
              </Pressable>
            </>
          )}
        </View>

        {selected ? (
          // --- One conversation -------------------------------------------
          <ChatViewer
            key={selected.sessionId}
            agentName={agentName}
            sessionId={selected.sessionId}
            title={selected.title}
            onBack={() => setSelected(null)}
          />
        ) : (
          // --- Session list -------------------------------------------------
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load('pull')}
                tintColor={theme.colors.accent}
                colors={[theme.colors.accent]}
              />
            }
          >
            {loading && sessions == null ? (
              <View style={styles.centerState}>
                <ActivityIndicator size="small" color={theme.colors.accent} />
                <Text style={styles.stateText}>Loading conversations…</Text>
              </View>
            ) : error != null && sessions == null ? (
              <View style={styles.centerState}>
                <Text style={styles.errorText} numberOfLines={3}>
                  Couldn’t load conversations — {error}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}
                  onPress={() => void load('initial')}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading conversations"
                >
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : (sessions ?? []).length === 0 ? (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.stateText}>
                  Trigger this agent and its chat history will appear here.
                </Text>
              </View>
            ) : (
              (sessions ?? []).map((session, index) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  last={index === (sessions ?? []).length - 1}
                  onPress={() =>
                    setSelected({
                      sessionId: session.sessionId,
                      title: session.title ?? null,
                    })
                  }
                />
              ))
            )}
          </ScrollView>
        )}

        <PromptModal
          visible={promptOpen}
          onClose={() => setPromptOpen(false)}
          agentName={agentName}
          onTriggered={handlePromptTriggered}
        />
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Session row — title + relative time + message count
// ---------------------------------------------------------------------------

function SessionRow({
  session,
  last,
  onPress,
}: {
  session: SessionSummary;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const fallbackTitle =
    typeof session.sessionId === 'string' && session.sessionId.length > 10
      ? `Session ${session.sessionId.slice(0, 8)}…`
      : 'Untitled session';
  const title =
    typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : fallbackTitle;

  const metaParts = [
    formatRelativeTime(session.timeCreated),
    session.messageCount != null
      ? `${session.messageCount} ${session.messageCount === 1 ? 'msg' : 'msgs'}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
      android_ripple={{ color: theme.colors.border }}
      accessibilityRole="button"
      accessibilityLabel={`Open conversation ${title}`}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Epoch-ms → human relative time ("Just now", "5m ago", "3h ago", "Aug 12"). */
function formatRelativeTime(epochMs: number | null): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '—';
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthsShort[date.getMonth()]} ${date.getDate()}`;
}

// ---------------------------------------------------------------------------

const makeStyles = (theme: Theme, bottomInset = 0) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    backGlyph: {
      fontSize: 30,
      lineHeight: 34,
      color: theme.colors.accent,
      paddingHorizontal: 2,
    },
    headerCenter: {
      flex: 1,
      minWidth: 0,
    },
    headerTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
    },
    headerCaption: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textTertiary,
    },
    iconBtn: {
      fontSize: 18,
      color: theme.colors.accent,
      paddingHorizontal: theme.spacing.xs,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingTop: theme.spacing.sm,
      paddingBottom: bottomInset + theme.spacing.xxl,
      paddingHorizontal: theme.spacing.lg,
    },
    centerState: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.xxl * 2,
      paddingHorizontal: theme.spacing.xl,
    },
    emptyTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
    },
    stateText: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      maxWidth: 260,
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

    // Session rows
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      paddingLeft: theme.spacing.xs,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowMain: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    rowTitle: {
      ...theme.type.body,
      fontWeight: '500',
      color: theme.colors.textPrimary,
    },
    rowMeta: {
      ...theme.type.caption,
      fontSize: 12,
      color: theme.colors.textTertiary,
    },
    chevron: {
      fontSize: 22,
      color: theme.colors.textTertiary,
    },
  });
