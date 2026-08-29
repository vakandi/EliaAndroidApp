/**
 * PromptModal — trigger a subworker with a custom prompt.
 *
 * Two modes:
 *  - single agent: pass `agentName` (used by agent detail + sessions list)
 *  - agent picker: pass `agents` (used by the homepage "New session" button)
 * Sends the typed prompt to POST /trigger/{name} via the store.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSubworkersStore } from '@/src/lib/store';
import type { SubworkerInfo } from '@/src/lib/types';
import { useTheme, type Theme } from '@/src/theme';

interface PromptModalProps {
  visible: boolean;
  onClose: () => void;
  /** Single-agent mode: trigger this agent directly. */
  agentName?: string;
  /** Picker mode: choose from these agents (homepage). */
  agents?: SubworkerInfo[];
  /** Called with the new session id as soon as the server creates it so the caller can open the live chat immediately. */
  onTriggered?: (agentName: string, sessionId: string) => void;
}

export function PromptModal({ visible, onClose, agentName, agents, onTriggered }: PromptModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme, insets.bottom);
  const triggerSubworker = useSubworkersStore((s) => s.triggerSubworker);

  const pickerAgents = useMemo(
    () => (agents && agents.length > 0 ? agents : []),
    [agents],
  );
  const singleMode = !!agentName && pickerAgents.length === 0;

  const [prompt, setPrompt] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPrompt('');
    setSelectedName(null);
    setDropdownOpen(false);
    setSending(false);
    setActionError(null);
  }, [visible]);

  const selectedAgent = useMemo(
    () => pickerAgents.find((a) => a.name === selectedName) ?? null,
    [pickerAgents, selectedName],
  );

  const targetName = singleMode ? agentName : selectedName;
  const canSend = !!targetName && prompt.trim() !== '' && !sending;

  const [waitingLabel, setWaitingLabel] = useState<string | null>(null);

  const handleSend = async () => {
    if (!targetName || prompt.trim() === '' || sending) return;
    setSending(true);
    setWaitingLabel('Starting…');
    setActionError(null);
    try {
      const timer = setTimeout(() => setWaitingLabel('Creating session…'), 1200);
      const sid = await triggerSubworker(targetName, prompt);
      clearTimeout(timer);
      if (sid) {
        if (onTriggered) onTriggered(targetName, sid);
        onClose();
        return;
      }
      setWaitingLabel(null);
      setActionError('Agent triggered but session did not appear yet — open Chats to follow it live.');
      // Still close after a beat so the caller can open the list, but keep the prompt reachable.
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setWaitingLabel(null);
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>New session</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close new session"
          >
            <Text style={styles.closeBtn}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!singleMode && (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Agent</Text>
              {pickerAgents.length === 0 ? (
                <Text style={styles.emptyAgents}>No agents available to trigger.</Text>
              ) : (
                <View style={styles.dropdownWrap}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.dropdownTrigger,
                      dropdownOpen && styles.dropdownTriggerOpen,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => setDropdownOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel="Select agent"
                  >
                    <Text
                      style={[
                        styles.dropdownTriggerText,
                        !selectedAgent && styles.dropdownPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {selectedAgent ? selectedAgent.name : 'Select an agent'}
                    </Text>
                    {selectedAgent && (
                      <View
                        style={[
                          styles.dropdownDot,
                          {
                            backgroundColor: selectedAgent.enabled
                              ? selectedAgent.running
                                ? theme.stateColors.running
                                : theme.stateColors.idle
                              : theme.colors.textTertiary,
                          },
                        ]}
                      />
                    )}
                    <Text style={styles.dropdownChevron}>{dropdownOpen ? '▲' : '▼'}</Text>
                  </Pressable>

                  {dropdownOpen && (
                    <View style={styles.dropdownList}>
                      <ScrollView
                        style={styles.dropdownScroll}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {pickerAgents.map((a) => {
                          const active = a.name === selectedName;
                          const dotColor = a.enabled
                            ? a.running
                              ? theme.stateColors.running
                              : theme.stateColors.idle
                            : theme.colors.textTertiary;
                          return (
                            <Pressable
                              key={a.id || a.name}
                              style={({ pressed }) => [
                                styles.dropdownItem,
                                active && styles.dropdownItemActive,
                                pressed && styles.rowPressed,
                              ]}
                              onPress={() => {
                                setSelectedName(a.name);
                                setDropdownOpen(false);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Select ${a.name}`}
                            >
                              <View style={[styles.dropdownDot, { backgroundColor: dotColor }]} />
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  active && styles.dropdownItemTextActive,
                                  !a.enabled && styles.dropdownItemTextDisabled,
                                ]}
                                numberOfLines={1}
                              >
                                {a.name}
                              </Text>
                              {!a.enabled && (
                                <Text style={styles.dropdownBadge}>disabled</Text>
                              )}
                              {active && <Text style={styles.dropdownCheck}>✓</Text>}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          <View style={styles.block}>
            <Text style={styles.blockLabel}>Prompt</Text>
            <TextInput
              style={styles.input}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the agent do?"
              placeholderTextColor={theme.colors.textTertiary}
              multiline
              autoFocus
              textAlignVertical="top"
            />
          </View>

          {actionError != null && (
            <Text style={styles.actionError} numberOfLines={2}>
              Couldn’t trigger — {actionError}
            </Text>
          )}
        </ScrollView>

        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend && styles.sendDisabled,
            pressed && canSend && styles.sendPressed,
          ]}
          onPress={() => void handleSend()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Trigger agent with this prompt"
        >
          {sending ? (
            <View style={styles.sendingRow}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              {waitingLabel && <Text style={styles.sendingLabel}>{waitingLabel}</Text>}
            </View>
          ) : (
            <Text style={styles.sendText}>
              {singleMode ? `Trigger ${agentName}` : 'Trigger agent'}
            </Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme, bottomInset = 0) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    headerTitle: {
      ...theme.type.title,
      color: theme.colors.textPrimary,
      flex: 1,
    },
    closeBtn: {
      ...theme.type.headline,
      color: theme.colors.accent,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: theme.spacing.lg,
      gap: theme.spacing.lg,
      paddingBottom: bottomInset + theme.spacing.xxl,
    },
    block: {
      gap: theme.spacing.sm,
    },
    blockLabel: {
      ...theme.type.caption,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textTertiary,
    },
    dropdownWrap: {
      position: 'relative',
      zIndex: 10,
    },
    dropdownTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.md,
      height: 44,
    },
    dropdownTriggerOpen: {
      borderColor: `${theme.colors.accent}80`,
    },
    dropdownTriggerText: {
      ...theme.type.body,
      flex: 1,
      color: theme.colors.textPrimary,
    },
    dropdownPlaceholder: {
      color: theme.colors.textTertiary,
    },
    dropdownDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dropdownChevron: {
      fontSize: 10,
      color: theme.colors.textTertiary,
      marginLeft: 2,
    },
    dropdownList: {
      marginTop: 6,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
      maxHeight: 220,
    },
    dropdownScroll: {
      maxHeight: 220,
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    dropdownItemActive: {
      backgroundColor: `${theme.colors.accent}0F`,
    },
    dropdownItemText: {
      ...theme.type.body,
      flex: 1,
      color: theme.colors.textPrimary,
    },
    dropdownItemTextActive: {
      color: theme.colors.accent,
      fontWeight: '600',
    },
    dropdownItemTextDisabled: {
      color: theme.colors.textTertiary,
    },
    dropdownBadge: {
      ...theme.type.caption,
      fontSize: 10,
      fontWeight: '600',
      color: theme.colors.textTertiary,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
    },
    dropdownCheck: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.accent,
    },
    rowPressed: {
      opacity: 0.8,
    },
    emptyAgents: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
    },
    input: {
      minHeight: 120,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      ...theme.type.body,
      color: theme.colors.textPrimary,
    },
    actionError: {
      ...theme.type.caption,
      color: theme.stateColors.error,
    },
    sendBtn: {
      height: 50,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: theme.spacing.lg,
      marginBottom: bottomInset + theme.spacing.lg,
    },
    sendPressed: {
      opacity: 0.85,
    },
    sendDisabled: {
      opacity: 0.45,
    },
    sendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    sendingLabel: {
      ...theme.type.headline,
      color: '#FFFFFF',
      fontSize: 14,
    },
    sendText: {
      ...theme.type.headline,
      color: '#FFFFFF',
    },
  });
