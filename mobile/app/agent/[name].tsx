/**
 * Agent detail screen — full control surface for one subworker (PLAN.md §3).
 * Info grid, enable/disable, trigger now, main-agent toggle, model picker
 * and the live logs panel. Route: /agent/[name].
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MonogramAvatar,
  deriveAgentState,
  formatLastCompleted,
  formatNextRun,
} from '@/src/components/AgentRow';
import { LogsPanel } from '@/src/components/LogsPanel';
import { ModelPickerModal } from '@/src/components/ModelPickerModal';
import { SessionsModal } from '@/src/components/SessionsModal';
import { StateBadge } from '@/src/components/StateBadge';
import { useSubworkersStore } from '@/src/lib/store';
import { useTheme, type Theme } from '@/src/theme';

function decodeName(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeParam(raw: string | string[] | undefined): string | null {
  const value = decodeName(raw);
  return value === '' ? null : value;
}

function isFlagParam(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === '1' || value === 'true';
}

export default function AgentDetailScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { name: rawName, chats: rawChats, session: rawSession } =
    useLocalSearchParams<{
      name: string;
      chats?: string | string[];
      session?: string | string[];
    }>();
  const agentName = decodeName(rawName);
  // Deep link from calendar chips (?chats=1&session=<id>) — consumed once
  // at mount so closing the modal doesn't re-trigger from stale params.
  const [chatsOpen, setChatsOpen] = useState(() => isFlagParam(rawChats));
  const [initialSessionId] = useState(() => decodeParam(rawSession));

  const subworkers = useSubworkersStore((s) => s.subworkers);
  const isLoading = useSubworkersStore((s) => s.isLoading);
  const mainAgentName = useSubworkersStore((s) => s.mainAgentName);
  const enableSubworker = useSubworkersStore((s) => s.enableSubworker);
  const disableSubworker = useSubworkersStore((s) => s.disableSubworker);
  const setMainAgent = useSubworkersStore((s) => s.setMainAgent);
  const triggerSubworker = useSubworkersStore((s) => s.triggerSubworker);

  const subworker = useMemo(
    () => subworkers.find((sw) => sw.name === agentName),
    [subworkers, agentName],
  );

  const [triggering, setTriggering] = useState(false);
  const [togglingEnable, setTogglingEnable] = useState(false);
  const [settingMain, setSettingMain] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const isMain = !!subworker && mainAgentName === subworker.name;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleTrigger = useCallback(async () => {
    if (!subworker || triggering) return;
    setTriggering(true);
    try {
      await triggerSubworker(subworker.name);
    } catch {
      // Failures surface via store error state.
    } finally {
      setTriggering(false);
    }
  }, [subworker, triggering, triggerSubworker]);

  const handleEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (!subworker || togglingEnable) return;
      setTogglingEnable(true);
      try {
        await (enabled ? enableSubworker(subworker.name) : disableSubworker(subworker.name));
      } catch {
        // Store surfaces the failure; switch snaps back to store truth.
      } finally {
        setTogglingEnable(false);
      }
    },
    [subworker, togglingEnable, enableSubworker, disableSubworker],
  );

  const handleMainChange = useCallback(
    async (value: boolean) => {
      // Only "make main" is supported by the server contract; unsetting is a no-op.
      if (!value || !subworker || isMain || settingMain) return;
      setSettingMain(true);
      try {
        await setMainAgent(subworker.name);
      } catch {
        // Store surfaces the failure.
      } finally {
        setSettingMain(false);
      }
    },
    [subworker, isMain, settingMain, setMainAgent],
  );

  // --- Loading / not-found guards ------------------------------------------
  if (!subworker) {
    return (
      <View style={[styles.screen, styles.guardWrap, { paddingTop: insets.top + theme.spacing.lg }]}>
        <View style={styles.headerRow}>
          <BackButton onPress={goBack} />
          <Text style={[theme.type.title, styles.textPrimary]} numberOfLines={1}>
            Agent
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.stateWrap}>
          {isLoading ? (
            <>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={styles.stateCaption}>Loading “{agentName || 'agent'}”…</Text>
            </>
          ) : (
            <>
              <MonogramAvatar name={agentName || '?'} size={56} />
              <Text style={styles.stateTitle}>Agent not found</Text>
              <Text style={styles.stateCaption}>
                “{agentName || 'Unknown'}” isn’t reported by the server right now.
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  const state = deriveAgentState(subworker);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <BackButton onPress={goBack} />
        <MonogramAvatar name={subworker.name} size={36} />
        <View style={styles.headerCenter}>
          <Text style={[theme.type.headline, styles.textPrimary]} numberOfLines={1}>
            {subworker.name}
          </Text>
          <StateBadge state={state} dotOnly />
        </View>
        {isMain && (
          <View style={styles.mainChip}>
            <Text style={styles.mainChipText}>★ Main</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Info grid */}
        <SectionCard>
          <InfoCell label="Status">
            <StateBadge state={state} />
          </InfoCell>
          <InfoCell label="Next run" caption={formatNextRun(subworker.nextRun)} />
          <InfoCell label="Schedule" caption={subworker.scheduleType ?? '—'} />
          <InfoCell label="Last completed" caption={formatLastCompleted(subworker.lastCompleted)} />
          {subworker.lastError != null && subworker.lastError.trim() !== '' && (
            <View style={styles.errorBlock}>
              <Text style={styles.errorLabel}>LAST ERROR</Text>
              <Text style={styles.errorBody}>{subworker.lastError}</Text>
            </View>
          )}
        </SectionCard>

        {/* Model row */}
        <Pressable
          style={({ pressed }) => [styles.sectionCard, pressed && styles.pressed]}
          onPress={() => setModelOpen(true)}
          android_ripple={{ color: theme.colors.border }}
          accessibilityRole="button"
          accessibilityLabel="Change model"
        >
          <View style={styles.modelRowLeft}>
            <Text style={styles.rowTitle}>Model</Text>
            <Text
              style={[styles.modelValue, !subworker.model && styles.placeholder]}
              numberOfLines={1}
            >
              {subworker.model
                ? subworker.variant
                  ? `${subworker.model} · ${subworker.variant}`
                  : subworker.model
                : 'Set a model'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {/* Chats row */}
        <Pressable
          style={({ pressed }) => [styles.sectionCard, pressed && styles.pressed]}
          onPress={() => setChatsOpen(true)}
          android_ripple={{ color: theme.colors.border }}
          accessibilityRole="button"
          accessibilityLabel="View this agent's conversations"
        >
          <View style={styles.modelRowLeft}>
            <Text style={styles.rowTitle}>Chats</Text>
            <Text style={styles.rowCaption}>Browse the agent's conversations</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {/* Controls */}
        <SectionCard gap={0}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabels}>
              <Text style={styles.rowTitle}>Enabled</Text>
              <Text style={styles.rowCaption}>Scheduled runs are allowed</Text>
            </View>
            <Switch
              value={subworker.enabled}
              onValueChange={(v) => void handleEnabledChange(v)}
              disabled={togglingEnable}
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Enable or disable this subworker"
            />
          </View>

          <View style={styles.separator} />

          <View style={styles.switchRow}>
            <View style={styles.switchLabels}>
              <Text style={styles.rowTitle}>Main agent</Text>
              <Text style={styles.rowCaption} numberOfLines={2}>
                {isMain
                  ? 'This agent is the ecosystem’s main agent.'
                  : `Currently: ${mainAgentName || 'none'}`}
              </Text>
            </View>
            <Switch
              value={isMain}
              onValueChange={(v) => void handleMainChange(v)}
              disabled={settingMain}
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Set as main agent"
            />
          </View>
        </SectionCard>

        {/* Trigger */}
        <Pressable
          style={({ pressed }) => [
            styles.triggerBtn,
            (triggering || !subworker.enabled) && styles.triggerDisabled,
            pressed && !(triggering || !subworker.enabled) && styles.pressed,
          ]}
          onPress={() => void handleTrigger()}
          disabled={triggering || !subworker.enabled}
          accessibilityRole="button"
          accessibilityLabel="Trigger this subworker now"
        >
          {triggering ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.triggerText}>Trigger Now</Text>
          )}
        </Pressable>
        {!subworker.enabled && (
          <Text style={styles.disabledHint}>
            Enable this agent to trigger it.
          </Text>
        )}

        {/* Logs */}
        <LogsPanel name={subworker.name} />
      </ScrollView>

      <ModelPickerModal
        visible={modelOpen}
        onClose={() => setModelOpen(false)}
        agentName={subworker.name}
        currentModel={subworker.model}
        currentVariant={subworker.variant}
      />

      <SessionsModal
        visible={chatsOpen}
        agentName={subworker.name}
        onClose={() => setChatsOpen(false)}
        initialSessionId={initialSessionId}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Local pieces
// ---------------------------------------------------------------------------

function BackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Text style={{ fontSize: 30, lineHeight: 34, color: theme.colors.accent, paddingHorizontal: 2 }}>
        ‹
      </Text>
    </Pressable>
  );
}

function SectionCard({ children, gap }: { children: React.ReactNode; gap?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        gap: gap ?? theme.spacing.lg,
      }}
    >
      {children}
    </View>
  );
}

interface InfoCellProps {
  label: string;
  caption?: string;
  children?: React.ReactNode;
}

function InfoCell({ label, caption, children }: InfoCellProps) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <Text style={{ ...theme.type.caption, color: theme.colors.textTertiary }}>{label}</Text>
      {children ?? (
        <Text
          style={{
            ...theme.type.body,
            color: theme.colors.textPrimary,
            textAlign: 'right',
            flexShrink: 1,
          }}
          numberOfLines={2}
        >
          {caption}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    guardWrap: {
      gap: theme.spacing.xl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    headerCenter: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    headerSpacer: {
      width: 28,
    },
    mainChip: {
      backgroundColor: `${theme.colors.accent}1A`,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    mainChipText: {
      ...theme.type.caption,
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.accent,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl * 2,
      gap: theme.spacing.lg,
    },
    sectionCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
    },
    pressed: {
      opacity: 0.85,
    },
    textPrimary: {
      color: theme.colors.textPrimary,
    },
    rowTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
    },
    rowCaption: {
      ...theme.type.caption,
      fontSize: 12,
      color: theme.colors.textTertiary,
    },
    errorBlock: {
      backgroundColor: 'rgba(239, 68, 68, 0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(239, 68, 68, 0.3)',
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    errorLabel: {
      ...theme.type.caption,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: theme.stateColors.error,
    },
    errorBody: {
      ...theme.type.caption,
      color: theme.stateColors.error,
    },
    modelRowLeft: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    modelValue: {
      ...theme.type.caption,
      fontFamily: 'monospace',
      color: theme.colors.textSecondary,
    },
    placeholder: {
      color: theme.colors.accent,
      fontFamily: undefined,
    },
    chevron: {
      fontSize: 22,
      color: theme.colors.textTertiary,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.lg,
    },
    switchLabels: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    triggerBtn: {
      height: 50,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    triggerDisabled: {
      opacity: 0.45,
    },
    triggerText: {
      ...theme.type.headline,
      color: '#FFFFFF',
    },
    disabledHint: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      marginTop: -6,
    },
    stateWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.xl,
    },
    stateTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
    },
    stateCaption: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
      maxWidth: 260,
    },
  });
