/**
 * AgentCollisionSheet — bottom-sheet chooser shown when several agents
 * have a scheduled run in the same calendar hour slot. Lists each colliding
 * agent (Avatar + name) with its latest conversation title underneath
 * (fetched lazily per row). Picking an entry hands the agent name back to
 * the caller, which navigates to its chat page.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/src/components/Avatar';
import { deriveAgentState } from '@/src/components/AgentRow';
import { SubworkerApi } from '@/src/lib/api';
import type { SubworkerInfo } from '@/src/lib/types';
import { useSettingsStore } from '@/src/lib/settings';
import { useTheme, type Theme } from '@/src/theme';

interface AgentCollisionSheetProps {
  visible: boolean;
  /** e.g. "Tue, Aug 25 · 2 PM" — the contested slot. */
  slotLabel: string;
  agents: SubworkerInfo[];
  onClose: () => void;
  onPick: (agentName: string) => void;
}

export function AgentCollisionSheet({
  visible,
  slotLabel,
  agents,
  onClose,
  onPick,
}: AgentCollisionSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close agent picker">
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.grabber} />
        <View style={styles.headerRow}>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {slotLabel}
            </Text>
            <Text style={styles.headerCaption}>
              {agents.length} agents run at this time
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {agents.map((agent) => (
            <CollisionRow
              key={agent.name}
              agent={agent}
              onPress={() => onPick(agent.name)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function CollisionRow({ agent, onPress }: { agent: SubworkerInfo; onPress: () => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const [latestTitle, setLatestTitle] = useState<string | null>(null);
  const [loadingTitle, setLoadingTitle] = useState(true);

  const loadLatestTitle = useCallback(async () => {
    try {
      const api = new SubworkerApi(
        () => serverUrl,
        () => useSettingsStore.getState().authToken,
      );
      const sessions = await api.getSessionsList(agent.name);
      const first = sessions[0];
      setLatestTitle(first?.title?.trim() || null);
    } catch {
      setLatestTitle(null);
    } finally {
      setLoadingTitle(false);
    }
  }, [agent.name, serverUrl]);

  useEffect(() => {
    void loadLatestTitle();
  }, [loadLatestTitle]);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      android_ripple={{ color: theme.colors.border }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${agent.name}`}
    >
      <Avatar name={agent.name} size={44} />
      <View style={styles.rowMain}>
        <View style={styles.rowNameRow}>
          <Text style={styles.rowName} numberOfLines={1}>
            {agent.name}
          </Text>
          <View
            style={[
              styles.stateDot,
              { backgroundColor: theme.stateColors[deriveAgentState(agent)] },
            ]}
          />
        </View>
        {loadingTitle ? (
          <ActivityIndicator size="small" color={theme.colors.textTertiary} style={styles.titleSpinner} />
        ) : (
          <Text style={styles.rowCaption} numberOfLines={1}>
            {latestTitle ?? 'No conversations yet'}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '65%',
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
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
    closeGlyph: {
      fontSize: 18,
      color: theme.colors.textTertiary,
      paddingHorizontal: theme.spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowMain: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    rowNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    rowName: {
      ...theme.type.body,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    stateDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    titleSpinner: {
      alignItems: 'flex-start',
    },
    rowCaption: {
      ...theme.type.caption,
      fontSize: 12,
      color: theme.colors.textTertiary,
    },
    chevron: {
      fontSize: 22,
      color: theme.colors.textTertiary,
    },
  });
