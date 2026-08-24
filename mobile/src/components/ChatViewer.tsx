/**
 * ChatViewer — full conversation transcript for one agent session (PLAN.md §8-I).
 *
 * ChatGPT-style transcript:
 * - user bubbles right on the accent, assistant bubbles left on surface
 * - `reasoning` parts render as collapsible "Thinking…" blocks
 * - tool calls render as expandable rows (input/output pretty-printed)
 * - per-message timestamps from info.timeCreated (epoch ms)
 * - optional 2s auto-refresh for a live "streaming" feel (new parts appear)
 * - sticky-bottom scroll-follow while the reader is already at the bottom
 *
 * Data: SubworkerApi.getSessionMessages(name, limit, sessionId) →
 * SessionMessagesResult; this component renders `result.messages`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { SubworkerApi } from '@/src/lib/api';
import type { ChatMessage, MessagePart } from '@/src/lib/session-types';
import { useSettingsStore } from '@/src/lib/settings';
import { MarkdownView } from '@/src/components/MarkdownView';
import { useTheme, type Theme } from '@/src/theme';

const CHAT_REFRESH_MS = 2000;
/** Matches the server default window used across the app's log viewers. */
const MESSAGE_LIMIT = 50;
const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });
const BUBBLE_MAX_WIDTH = '86%';
/** Distance (px) from bottom under which auto-scroll follows new content. */
const STICKY_BOTTOM_EPSILON = 120;

interface ChatViewerProps {
  agentName: string;
  sessionId: string;
  /** Session title shown in the header (falls back to a neutral label). */
  title?: string | null;
  /** Called when the back control is pressed (e.g. return to session list). */
  onBack?: () => void;
}

export function ChatViewer({ agentName, sessionId, title, onBack }: ChatViewerProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const serverUrl = useSettingsStore((s) => s.serverUrl);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  /** Model name of the latest assistant message — shown as header context. */
  const [modelLabel, setModelLabel] = useState<string | null>(null);

  const inFlight = useRef(false);
  /** Cheap change signature so polls don't churn state when nothing moved. */
  const lastSignature = useRef('');
  const scrollRef = useRef<ScrollView | null>(null);
  const nearBottom = useRef(true);

  const load = useCallback(async () => {
    if (inFlight.current || !agentName || !sessionId) return;
    inFlight.current = true;
    try {
      const api = new SubworkerApi(
        () => serverUrl,
        () => useSettingsStore.getState().authToken,
      );
      const msgs = await api.getSessionMessages(agentName, sessionId, MESSAGE_LIMIT);
      const last = msgs[msgs.length - 1];
      const signature = `${msgs.length}:${last?.parts.length ?? 0}:${last?.info.timeCreated ?? ''}`;
      if (signature !== lastSignature.current) {
        lastSignature.current = signature;
        setMessages(msgs);
        setModelLabel(
          [...msgs].reverse().find((m) => m.info.model != null)?.info.model ?? null,
        );
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [agentName, serverUrl, sessionId]);

  // Initial load + reload when the target session changes.
  useEffect(() => {
    setMessages(null);
    setLoading(true);
    setError(null);
    setModelLabel(null);
    lastSignature.current = '';
    nearBottom.current = true;
    void load();
  }, [load]);

  // Auto-refresh cadence — the "streaming feel". Cleaned up on toggle-off/unmount.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void load(), CHAT_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Follow new content only while the reader is already at the bottom.
  useEffect(() => {
    if (!nearBottom.current) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(id);
  }, [messages]);

  const handleScroll = useCallback((e: {
    nativeEvent: {
      contentOffset: { y: number };
      layoutMeasurement: { height: number };
      contentSize: { height: number };
    };
  }) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    nearBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - STICKY_BOTTOM_EPSILON;
  }, []);

  const messageCount = messages?.length ?? 0;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to sessions"
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title && title.trim() !== '' ? title : 'Conversation'}
          </Text>
          <Text style={styles.headerCaption} numberOfLines={1}>
            {messageCount > 0
              ? [
                  `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`,
                  modelLabel,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : ' '}
          </Text>
        </View>
        <View style={styles.headerControls}>
          <Text style={styles.autoLabel}>Live</Text>
          <Switch
            value={autoRefresh}
            onValueChange={setAutoRefresh}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            thumbColor="#FFFFFF"
            style={styles.switch}
            accessibilityLabel="Auto-refresh conversation every 2 seconds"
          />
          <Pressable
            onPress={() => void load()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Refresh conversation now"
          >
            <Text style={styles.iconBtn}>↻</Text>
          </Pressable>
        </View>
      </View>

      {/* Transcript */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
      >
        {loading && messages == null ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.stateText}>Loading conversation…</Text>
          </View>
        ) : error != null && messages == null ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText} numberOfLines={3}>
              Couldn’t load this conversation — {error}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading conversation"
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : messageCount === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.stateText}>
              New output appears here live as soon as this agent starts talking.
            </Text>
          </View>
        ) : (
          (messages ?? []).map((msg, index) => (
            <MessageBlock key={`${msg.info.timeCreated ?? 't'}-${index}`} message={msg} />
          ))
        )}
      </ScrollView>

      {/* Live footer */}
      {!loading && error == null && messageCount > 0 && (
        <Text style={styles.footerCaption}>
          {autoRefresh
            ? `Live · refreshing every ${CHAT_REFRESH_MS / 1000}s`
            : 'Paused · turn Live on to follow new output'}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// One message → role-aligned bubble
// ---------------------------------------------------------------------------

function MessageBlock({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  // Contract: info.role is nullable — anything that isn't "user" reads left.
  const isUser = (message.info.role ?? '').toLowerCase() === 'user';

  const textParts = useMemo(
    () =>
      message.parts.filter(
        (p): p is MessagePart & { text: string } => p.type === 'text' && typeof p.text === 'string',
      ),
    [message.parts],
  );
  const richParts = useMemo(
    () =>
      message.parts.filter(
        (p) => p.type === 'reasoning' || p.type === 'tool',
      ),
    [message.parts],
  );

  const body = textParts.map((p) => p.text).join('\n\n').trim();

  return (
    <View style={[styles.messageRow, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          richParts.length > 0 && styles.bubbleWide,
        ]}
      >
        {body !== '' ? (
          isUser ? (
            <Text style={styles.bubbleTextUser}>{body}</Text>
          ) : (
            <MarkdownView content={body} />
          )
        ) : (
          richParts.length === 0 && (
            <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextEmpty}>
              (empty message)
            </Text>
          )
        )}

        {/* Reasoning + tool-call parts render inside the assistant bubble. */}
        {!isUser && richParts.length > 0 && (
          <View style={[styles.richStack, body !== '' && styles.richStackSpaced]}>
            {richParts.map((part, i) =>
              part.type === 'reasoning' ? (
                <ReasoningBlock key={`r-${i}`} part={part} />
              ) : (
                <ToolCallRow key={`t-${i}`} part={part} />
              ),
            )}
          </View>
        )}

        <Text style={isUser ? styles.timestampUser : styles.timestampAssistant}>
          {formatClock(message.info.timeCreated)}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reasoning — collapsible "Thinking…" block (ChatGPT style)
// ---------------------------------------------------------------------------

function ReasoningBlock({ part }: { part: MessagePart }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);
  const summary = firstSentence(part.text);

  return (
    <View style={styles.reasonCard}>
      <Pressable
        style={({ pressed }) => [styles.collapseHeader, pressed && styles.rowPressed]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Hide reasoning' : 'Show reasoning'}
      >
        <Text style={styles.reasonGlyph}>✦</Text>
        <Text style={styles.collapseTitle} numberOfLines={expanded ? undefined : 1}>
          {expanded ? 'Thought process' : `Thinking…${summary !== '' ? ` ${summary}` : ''}`}
        </Text>
        <Text style={styles.collapseChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded && (
        typeof part.text === 'string' && part.text.trim() !== '' ? (
          <MarkdownView content={part.text.trim()} />
        ) : (
          <Text style={styles.reasonBody}>(no reasoning detail recorded)</Text>
        )
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tool call — compact row, expandable input/output
// ---------------------------------------------------------------------------

function ToolCallRow({ part }: { part: MessagePart }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);

  const toolName =
    typeof part.tool === 'string' && part.tool.trim() !== '' ? part.tool.trim() : 'tool';

  const inputText = pretty(part.input);
  const outputText = pretty(part.output);

  return (
    <View style={styles.toolCard}>
      <Pressable
        style={({ pressed }) => [styles.collapseHeader, pressed && styles.rowPressed]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? `Hide details of ${toolName}` : `Show details of ${toolName}`}
      >
        <Text style={styles.toolGlyph}>⚙</Text>
        <Text style={styles.toolName} numberOfLines={1}>
          {toolName}
        </Text>
        <Text style={styles.collapseChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.toolDetailStack}>
          {inputText != null && (
            <View style={styles.toolDetail}>
              <Text style={styles.detailLabel}>INPUT</Text>
              <Text style={styles.detailBody} selectable>
                {inputText}
              </Text>
            </View>
          )}
          {outputText != null && (
            <View style={styles.toolDetail}>
              <Text style={styles.detailLabel}>OUTPUT</Text>
              <Text style={styles.detailBody} selectable>
                {outputText}
              </Text>
            </View>
          )}
          {inputText == null && outputText == null && (
            <Text style={styles.detailEmpty}>No input or output recorded.</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small helpers (kept local — Unit I touches only its own files)
// ---------------------------------------------------------------------------

/** Epoch-ms timestamp → HH:MM, or an em-dash when unknown. */
function formatClock(epochMs: number | null): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '—';
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function firstSentence(text: unknown): string {
  if (typeof text !== 'string') return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return '';
  const cut = trimmed.slice(0, 64);
  return cut.length < trimmed.length ? `${cut}…` : cut;
}

/** Pretty-print unknown tool payloads; plain strings pass through untouched. */
function pretty(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------

const makeStyles = (theme: Theme) =>
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
    headerSpacer: {
      width: 28,
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
    headerControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    autoLabel: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textSecondary,
    },
    switch: {
      transform: [{ scale: 0.75 }],
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
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl * 2,
      gap: theme.spacing.md,
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
    footerCaption: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      paddingBottom: theme.spacing.sm,
    },

    // Bubbles
    messageRow: {
      flexDirection: 'row',
    },
    rowUser: {
      justifyContent: 'flex-end',
    },
    rowAssistant: {
      justifyContent: 'flex-start',
    },
    bubble: {
      maxWidth: BUBBLE_MAX_WIDTH,
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    // Rich cards read better with more room than short chat lines.
    bubbleWide: {
      maxWidth: '96%',
    },
    bubbleUser: {
      backgroundColor: theme.colors.accent,
      borderBottomRightRadius: theme.radius.sm,
    },
    bubbleAssistant: {
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderBottomLeftRadius: theme.radius.sm,
    },
    bubbleTextUser: {
      ...theme.type.body,
      color: '#FFFFFF',
    },
    bubbleTextAssistant: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
    },
    bubbleTextEmpty: {
      ...theme.type.body,
      fontStyle: 'italic',
      color: theme.colors.textTertiary,
    },
    timestampUser: {
      ...theme.type.caption,
      fontSize: 10,
      color: 'rgba(255,255,255,0.72)',
      alignSelf: 'flex-end',
      marginTop: theme.spacing.xs,
    },
    timestampAssistant: {
      ...theme.type.caption,
      fontSize: 10,
      color: theme.colors.textTertiary,
      alignSelf: 'flex-start',
      marginTop: theme.spacing.xs,
    },

    // Rich parts inside assistant bubbles
    richStack: {
      gap: theme.spacing.sm,
    },
    richStackSpaced: {
      marginTop: theme.spacing.xs,
    },
    collapseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: 2,
    },
    rowPressed: {
      opacity: 0.7,
    },
    collapseTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      fontWeight: '500',
      fontStyle: 'italic',
      color: theme.colors.textSecondary,
    },
    collapseChevron: {
      fontSize: 12,
      color: theme.colors.textTertiary,
    },

    // Reasoning card
    reasonCard: {
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${theme.colors.accent}33`,
      backgroundColor: `${theme.colors.accent}0A`,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    reasonGlyph: {
      fontSize: 12,
      color: theme.colors.accent,
    },
    reasonBody: {
      fontSize: 13,
      lineHeight: 19,
      color: theme.colors.textSecondary,
      borderLeftWidth: 2,
      borderLeftColor: `${theme.colors.accent}55`,
      paddingLeft: theme.spacing.md,
    },

    // Tool call card
    toolCard: {
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    toolGlyph: {
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    toolName: {
      flex: 1,
      minWidth: 0,
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    toolDetailStack: {
      gap: theme.spacing.sm,
    },
    toolDetail: {
      gap: 4,
    },
    detailLabel: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: theme.colors.textTertiary,
    },
    detailBody: {
      fontFamily: MONO_FONT,
      fontSize: 11,
      lineHeight: 16,
      color: theme.colors.textSecondary,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: theme.spacing.sm,
    },
    detailEmpty: {
      fontSize: 12,
      fontStyle: 'italic',
      color: theme.colors.textTertiary,
    },
  });
