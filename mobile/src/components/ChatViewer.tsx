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
import { useSubworkersStore } from '@/src/lib/store';
import { onLive } from '@/src/lib/liveBus';
import { MarkdownView } from '@/src/components/MarkdownView';
import { useTheme, type Theme } from '@/src/theme';

const CHAT_REFRESH_MS = 2000;
/** Matches the server default window used across the app's log viewers. */
const MESSAGE_LIMIT = 50;
const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });
const BUBBLE_MAX_WIDTH = '86%';
/** Distance (px) from bottom under which auto-scroll follows new content. */
const STICKY_BOTTOM_EPSILON = 120;

type LiveEntry =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: string | null; output: string | null };

function hostPath(p: string): string {
  if (p.startsWith('/data/')) return p.replace('/data/', '/Users/vakandi/EliaAI/');
  if (p === '/data') return '/Users/vakandi/EliaAI';
  return p;
}
function streamingSafeMarkdown(t: string): string {
  const c = (t.match(/```/g) || []).length;
  return c % 2 === 1 ? t + '\n```' : t;
}

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
  const [liveEntries, setLiveEntries] = useState<LiveEntry[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [liveTick, setLiveTick] = useState(0);

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

  const isAgentRunning = useSubworkersStore((s) => s.subworkers.find((x) => x.name === agentName)?.running ?? false);
  useEffect(() => {
    if (isAgentRunning && !liveRunning) {
      setLiveRunning(true);
      if (!liveStartedAt) setLiveStartedAt(Date.now());
    } else if (!isAgentRunning && liveRunning && liveEntries.length === 0) {
      setLiveRunning(false);
    } else if (!isAgentRunning) {
      // keep liveRunning true briefly if we have live content (let user see it)
      if (liveEntries.length === 0) setLiveRunning(false);
    }
  }, [isAgentRunning, liveRunning, liveEntries.length, liveStartedAt]);

  useEffect(() => {
    if (!liveRunning) return;
    const id = setInterval(() => setLiveTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [liveRunning]);

  useEffect(() => {
    if (!agentName) return;
    const unsub = onLive((agent, field, delta) => {
      if (agent !== agentName) return;
      setLiveRunning(true);
      setLiveStartedAt((prev) => prev ?? Date.now());
      setLiveEntries((prev) => {
        if (field === 'tool') {
          let parsed: { name: string; input: string | null; output: string | null } = { name: 'tool', input: null, output: null };
          try {
            const obj = JSON.parse(delta) as Record<string, unknown>;
            const tool = typeof obj.tool === 'string' ? obj.tool : 'tool';
            if (obj.filePath != null || obj.oldString != null || obj.content != null) {
              parsed = { name: tool, input: delta, output: typeof obj.output === 'string' ? obj.output : null };
            } else {
              parsed = { name: tool, input: typeof obj.input === 'string' ? obj.input : null, output: typeof obj.output === 'string' ? obj.output : null };
            }
          } catch {
            parsed = { name: delta || 'tool', input: null, output: null };
          }
          const last = prev[prev.length - 1];
          if (last && last.kind === 'tool' && last.name === parsed.name && last.input === parsed.input && last.output === parsed.output) return prev;
          const next = [...prev, { kind: 'tool', name: parsed.name, input: parsed.input, output: parsed.output } as LiveEntry];
          return next.length > 40 ? next.slice(-40) : next;
        }
        if (field === 'reasoning') {
          const last = prev[prev.length - 1];
          if (last && last.kind === 'reasoning') {
            if (delta === last.text || last.text.endsWith(delta) || (last.text.includes(delta) && delta.length < 40)) return prev;
            let next = last.text;
            if (delta.startsWith(last.text)) next = delta;
            else if (last.text === '') next = delta;
            else next = last.text + delta;
            if (next.length > 12000) next = next.slice(-8000);
            return [...prev.slice(0, -1), { kind: 'reasoning', text: next }];
          }
          return [...prev, { kind: 'reasoning', text: delta.length > 12000 ? delta.slice(-8000) : delta }];
        }
        // text
        const last = prev[prev.length - 1];
        if (last && last.kind === 'text') {
          if (delta === last.text) return prev;
          if (delta.length < 80 && last.text.includes(delta)) return prev;
          if (last.text.endsWith(delta)) return prev;
          let next = delta.startsWith(last.text) ? delta : last.text + delta;
          if (next.length > 12000) next = next.slice(-8000);
          return [...prev.slice(0, -1), { kind: 'text', text: next }];
        }
        return [...prev, { kind: 'text', text: delta.length > 12000 ? delta.slice(-8000) : delta }];
      });
    });
    return unsub;
  }, [agentName]);

  useEffect(() => {
    // Clear live when switching sessions
    setLiveEntries([]);
    setLiveRunning(isAgentRunning);
    if (isAgentRunning) setLiveStartedAt(Date.now());
    else setLiveStartedAt(null);
  }, [sessionId, agentName, isAgentRunning]);

  // Follow new content only while the reader is already at the bottom.
  useEffect(() => {
    if (!nearBottom.current) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(id);
  }, [messages]);
  useEffect(() => {
    if (!nearBottom.current || liveEntries.length === 0) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(id);
  }, [liveEntries]);

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
        ) : (
          <>
            {messageCount > 0 &&
              (messages ?? []).map((msg, index) => (
                <MessageBlock key={`${msg.info.timeCreated ?? 't'}-${index}`} message={msg} />
              ))}
            {liveEntries.length > 0 ? (
              <LiveStreamPanel entries={liveEntries} agentName={agentName} />
            ) : liveRunning ? (
              <LiveWaitingView startedAt={liveStartedAt} tick={liveTick} />
            ) : messageCount === 0 ? (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.stateText}>
                  New output appears here live as soon as this agent starts talking.
                </Text>
              </View>
            ) : null}
          </>
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

function toolSummary(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) return null;
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return null;
  };
  // Common tool args — ordered by likelihood
  const raw =
    pick(['command', 'cmd', 'query', 'pattern', 'path', 'filePath', 'file', 'url', 'content']) ??
    (() => {
      const vals = Object.values(input);
      const first = vals.find((v) => typeof v === 'string' && (v as string).trim() !== '');
      return typeof first === 'string' ? (first as string).trim() : null;
    })();
  if (!raw) return null;
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine;
}

function getFilePath(input: Record<string, unknown> | null | undefined): string | null {
  if (!input) return null;
  for (const k of ['filePath', 'file_path', 'path', 'filepath']) {
    const v = input[k];
    if (typeof v === 'string' && v.trim() !== '') return hostPath(v.trim());
  }
  return null;
}
function ToolCallRow({ part }: { part: MessagePart }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);

  const toolName =
    typeof part.tool === 'string' && part.tool.trim() !== '' ? part.tool.trim() : 'tool';
  const lower = toolName.toLowerCase();
  const filePath = getFilePath(part.input);
  // Special summary for write/edit: show absolute path instead of generic content snippet
  const summary =
    (lower === 'write' || lower === 'edit') && filePath
      ? filePath.split('/').pop() || filePath
      : toolSummary(part.input);

  const inputText = pretty(part.input);
  const outputText = pretty(part.output);
  const oldStr = lower === 'edit' ? (typeof part.input?.['oldString'] === 'string' ? (part.input?.['oldString'] as string) : typeof part.input?.['old_string'] === 'string' ? (part.input?.['old_string'] as string) : null) : null;
  const newStr = lower === 'edit' ? (typeof part.input?.['newString'] === 'string' ? (part.input?.['newString'] as string) : typeof part.input?.['new_string'] === 'string' ? (part.input?.['new_string'] as string) : null) : null;
  const isEditWithDiff = lower === 'edit' && (oldStr != null || newStr != null);

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
        <View style={styles.toolHeaderText}>
          <Text style={styles.toolName} numberOfLines={1}>
            {toolName}
          </Text>
          {!expanded && summary ? (
            <Text style={styles.toolSummary} numberOfLines={1}>
              · {summary}
            </Text>
          ) : null}
        </View>
        <Text style={styles.collapseChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.toolDetailStack}>
          {isEditWithDiff ? (
            <>
              {filePath && (
                <View style={styles.toolDetail}>
                  <Text style={styles.detailLabel}>FILE</Text>
                  <Text style={styles.detailBody} selectable>{filePath}</Text>
                </View>
              )}
              <EditDiffContent oldStr={oldStr ?? ''} newStr={newStr ?? ''} />
              {outputText != null && (
                <View style={styles.toolDetail}>
                  <Text style={styles.detailLabel}>OUTPUT</Text>
                  <Text style={styles.detailBody} selectable>{outputText}</Text>
                </View>
              )}
            </>
          ) : lower === 'write' && filePath ? (
            <>
              <View style={styles.toolDetail}>
                <Text style={styles.detailLabel}>FILE</Text>
                <Text style={styles.detailBody} selectable>{filePath}</Text>
              </View>
              {(() => {
                const c = typeof part.input?.['content'] === 'string' ? (part.input?.['content'] as string) : null;
                return c ? (
                  <View style={styles.toolDetail}>
                    <Text style={styles.detailLabel}>CONTENT</Text>
                    <Text style={styles.detailBody} selectable>{c.slice(0, 600) + (c.length > 600 ? '…' : '')}</Text>
                  </View>
                ) : null;
              })()}
              {outputText != null && (
                <View style={styles.toolDetail}>
                  <Text style={styles.detailLabel}>OUTPUT</Text>
                  <Text style={styles.detailBody} selectable>{outputText}</Text>
                </View>
              )}
            </>
          ) : (
            <>
              {inputText != null && (
                <View style={styles.toolDetail}>
                  <Text style={styles.detailLabel}>INPUT</Text>
                  <Text style={styles.detailBody} selectable>{inputText}</Text>
                </View>
              )}
              {outputText != null && (
                <View style={styles.toolDetail}>
                  <Text style={styles.detailLabel}>OUTPUT</Text>
                  <Text style={styles.detailBody} selectable>{outputText}</Text>
                </View>
              )}
              {inputText == null && outputText == null && (
                <Text style={styles.detailEmpty}>No input or output recorded.</Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Live stream — mirrors EliaTopBar LogPopover live panel
// ---------------------------------------------------------------------------

function EditDiffContent({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const rows = lineDiff(oldLines, newLines).slice(0, 80);
  const added = rows.filter((r) => r.kind === 'added').length;
  const removed = rows.filter((r) => r.kind === 'removed').length;
  return (
    <View style={styles.diffContainer}>
      <View style={styles.diffHeader}>
        <Text style={styles.diffCounts}>+{added} −{removed}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={[styles.diffRow, r.kind === 'added' ? styles.diffAddedBg : r.kind === 'removed' ? styles.diffRemovedBg : null]}>
          <Text style={[styles.diffPrefix, r.kind === 'added' ? styles.diffAdded : r.kind === 'removed' ? styles.diffRemoved : styles.diffUnchanged]}>{r.kind === 'added' ? '+' : r.kind === 'removed' ? '−' : ' '}</Text>
          <Text style={[styles.diffText, r.kind === 'added' ? styles.diffAdded : r.kind === 'removed' ? styles.diffRemoved : styles.diffUnchangedText]} numberOfLines={1}>{r.text}</Text>
        </View>
      ))}
      {oldLines.length + newLines.length > 80 && <Text style={styles.diffMore}>… more lines</Text>}
    </View>
  );
}
function lineDiff(old: string[], nw: string[]): { kind: 'added' | 'removed' | 'unchanged'; text: string }[] {
  if (old.length === 0) return nw.map((t) => ({ kind: 'added' as const, text: t }));
  if (nw.length === 0) return old.map((t) => ({ kind: 'removed' as const, text: t }));
  let i = 0, j = 0;
  const out: { kind: 'added' | 'removed' | 'unchanged'; text: string }[] = [];
  while (i < old.length || j < nw.length) {
    if (i < old.length && j < nw.length && old[i] === nw[j]) { out.push({ kind: 'unchanged', text: old[i] }); i++; j++; }
    else if (j < nw.length && (i >= old.length || !old.slice(i).includes(nw[j]))) { out.push({ kind: 'added', text: nw[j] }); j++; }
    else if (i < old.length) { out.push({ kind: 'removed', text: old[i] }); i++; }
    else { out.push({ kind: 'added', text: nw[j] }); j++; }
  }
  return out;
}

function LiveStreamPanel({ entries, agentName }: { entries: LiveEntry[]; agentName: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.livePanel}>
      <View style={styles.liveHeader}>
        <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
        <Text style={styles.liveAgent} numberOfLines={1}>{agentName}</Text>
        <View style={styles.liveDot} />
      </View>
      {entries.map((e, idx) => {
        if (e.kind === 'reasoning') {
          return (
            <View key={idx} style={styles.liveReasoningWrap}>
              <Text style={styles.liveThinkingLabel}>THINKING</Text>
              <View style={styles.liveReasoningRow}>
                <View style={styles.liveReasoningBar} />
                <MarkdownView content={e.text} />
              </View>
            </View>
          );
        }
        if (e.kind === 'tool') {
          const raw = e.input ?? '';
          let toolObj: Record<string, unknown> | null = null;
          try { toolObj = JSON.parse(raw) as Record<string, unknown>; } catch {}
          const name = e.name;
          const lower = name.toLowerCase();
          if (lower === 'edit' && toolObj) {
            const fp = (toolObj.filePath as string) || (toolObj['file_path'] as string) || (toolObj.path as string) || '';
            const oldS = (toolObj.oldString as string) || (toolObj['old_string'] as string) || '';
            const newS = (toolObj.newString as string) || (toolObj['new_string'] as string) || '';
            if (fp && (oldS || newS)) {
              return <View key={idx} style={styles.liveToolWrap}><EditDiffContent oldStr={oldS} newStr={newS} /></View>;
            }
          }
          if (lower === 'write' && toolObj) {
            const fp = (toolObj.filePath as string) || (toolObj['file_path'] as string) || (toolObj.path as string) || '';
            const content = (toolObj.content as string) || '';
            if (fp) {
              return (
                <View key={idx} style={styles.liveToolWrap}>
                  <View style={styles.writeBanner}>
                    <Text style={styles.writeFileName}>{fp.split('/').pop()}</Text>
                    <Text style={styles.writeFileDir} numberOfLines={1}>{hostPath(fp).split('/').slice(0, -1).join('/')}</Text>
                    {content ? <Text style={styles.writePreview} numberOfLines={3}>{content.slice(0, 300)}</Text> : null}
                  </View>
                </View>
              );
            }
          }
          return (
            <View key={idx} style={styles.liveToolWrap}>
              <View style={styles.toolCard}>
                <Text style={styles.toolName}>{name}</Text>
                {e.input ? <Text style={styles.detailBody} numberOfLines={2}>{e.input.slice(0, 400)}</Text> : null}
                {e.output ? <Text style={styles.detailBody} numberOfLines={2}>{e.output.slice(0, 400)}</Text> : null}
              </View>
            </View>
          );
        }
        return (
          <View key={idx} style={styles.liveTextWrap}>
            <MarkdownView content={streamingSafeMarkdown(e.text)} />
          </View>
        );
      })}
    </View>
  );
}

function LiveWaitingView({ startedAt, tick }: { startedAt: number | null; tick: number }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const dots = '.'.repeat((tick % 3) + 1);
  return (
    <View style={styles.liveWaiting}>
      <View style={styles.liveHeader}>
        <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
        <Text style={styles.liveAgent}>waiting</Text>
        <ActivityIndicator size="small" color={theme.colors.accent} />
        <Text style={styles.liveElapsed}>{elapsedStr}</Text>
      </View>
      <View style={styles.waitingBody}>
        <View style={styles.waitingRow}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.waitingText}>Agent running{dots}</Text>
        </View>
        <Text style={styles.waitingSub}>Connecting to opencode • waiting for first token</Text>
        <View style={styles.waitingMeta}>
          <View style={[styles.liveDot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.waitingMetaText}>WS: streaming</Text>
        </View>
      </View>
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
    toolHeaderText: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      overflow: 'hidden',
    },
    toolName: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    toolSummary: {
      flex: 1,
      minWidth: 0,
      fontFamily: MONO_FONT,
      fontSize: 11,
      color: theme.colors.textTertiary,
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
    livePanel: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${theme.colors.accent}33`,
      backgroundColor: `${theme.colors.surface}`,
      padding: theme.spacing.md,
    },
    liveHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    liveBadge: {
      backgroundColor: '#f97316',
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    liveBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: '#FFFFFF',
    },
    liveAgent: {
      flex: 1,
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#f97316',
    },
    liveElapsed: {
      fontSize: 11,
      color: theme.colors.textTertiary,
    },
    liveReasoningWrap: {
      gap: 4,
    },
    liveThinkingLabel: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.6,
      color: theme.colors.textTertiary,
    },
    liveReasoningRow: {
      flexDirection: 'row',
      gap: 8,
    },
    liveReasoningBar: {
      width: 2,
      backgroundColor: `${theme.colors.textTertiary}55`,
      borderRadius: 1,
    },
    liveTextWrap: {
      gap: 4,
    },
    liveToolWrap: {
      gap: 4,
    },
    liveWaiting: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${theme.colors.accent}33`,
      backgroundColor: `${theme.colors.accent}0A`,
      padding: theme.spacing.md,
    },
    waitingBody: {
      gap: theme.spacing.sm,
      backgroundColor: `${theme.colors.surface}`,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    waitingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    waitingText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textPrimary,
    },
    waitingSub: {
      fontSize: 11,
      color: theme.colors.textTertiary,
    },
    waitingMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
    waitingMetaText: {
      fontSize: 10,
      color: theme.colors.textTertiary,
    },
    diffContainer: {
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      padding: theme.spacing.sm,
      gap: 2,
    },
    diffHeader: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: 4,
    },
    diffCounts: {
      fontFamily: MONO_FONT,
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.textSecondary,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    diffRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    diffAddedBg: {
      backgroundColor: '#22c55e14',
    },
    diffRemovedBg: {
      backgroundColor: '#ef444414',
    },
    diffPrefix: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontWeight: '700',
      width: 14,
      textAlign: 'center',
    },
    diffAdded: {
      color: '#16a34a',
    },
    diffRemoved: {
      color: '#dc2626',
    },
    diffUnchanged: {
      color: theme.colors.textTertiary,
    },
    diffUnchangedText: {
      color: theme.colors.textSecondary,
    },
    diffText: {
      flex: 1,
      fontFamily: MONO_FONT,
      fontSize: 11,
      lineHeight: 16,
    },
    diffMore: {
      fontSize: 11,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      marginTop: 4,
    },
    writeBanner: {
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#22c55e55',
      backgroundColor: '#22c55e0A',
      padding: theme.spacing.sm,
      gap: 4,
    },
    writeFileName: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontWeight: '700',
      color: '#16a34a',
    },
    writeFileDir: {
      fontFamily: MONO_FONT,
      fontSize: 10,
      color: theme.colors.textTertiary,
    },
    writePreview: {
      fontFamily: MONO_FONT,
      fontSize: 11,
      color: theme.colors.textSecondary,
      backgroundColor: theme.colors.surface,
      padding: 6,
      borderRadius: 4,
      marginTop: 4,
    },
  });
