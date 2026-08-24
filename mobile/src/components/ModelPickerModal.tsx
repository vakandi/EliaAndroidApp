/**
 * ModelPickerModal — searchable model catalog over `/models` (500+ entries,
 * virtualized FlatList). Flow: search → pick model → pick variant chip →
 * confirm `setModel`. Shows the agent's current selection at the top.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ModelOption } from '@/src/lib/types';
import { useSubworkersStore } from '@/src/lib/store';
import { useTheme, type Theme } from '@/src/theme';

interface ModelPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Target subworker name for setModel. */
  agentName: string;
  currentModel: string | null;
  currentVariant: string | null;
}

export function ModelPickerModal({
  visible,
  onClose,
  agentName,
  currentModel,
  currentVariant,
}: ModelPickerModalProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const availableModels = useSubworkersStore((s) => s.availableModels);
  const setModel = useSubworkersStore((s) => s.setModel);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset the picker each time it opens, preselecting the current model.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setActionError(null);
    setSaving(false);
    setSelectedId(currentModel ?? null);
    setSelectedVariant(currentVariant ?? null);
  }, [visible, currentModel, currentVariant]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableModels;
    const tokens = q.split(/\s+/);
    return availableModels.filter((m) => {
      const haystack = `${m.id} ${m.name} ${m.provider}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [availableModels, query]);

  const selectedOption: ModelOption | undefined = useMemo(
    () => availableModels.find((m) => m.id === selectedId),
    [availableModels, selectedId],
  );

  const handleSelect = (option: ModelOption) => {
    setActionError(null);
    if (option.id === selectedId) {
      setSelectedId(null);
      setSelectedVariant(null);
      return;
    }
    setSelectedId(option.id);
    setSelectedVariant(
      option.variants.length > 0 ? (option.variants[0] ?? null) : '',
    );
  };

  const canConfirm =
    !!selectedOption &&
    !saving &&
    (selectedOption.variants.length === 0 || !!selectedVariant);

  const handleConfirm = async () => {
    if (!selectedOption || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await setModel(agentName, selectedOption.id, selectedVariant ?? '');
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Model</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close model picker">
            <Text style={styles.closeBtn}>Done</Text>
          </Pressable>
        </View>

        {/* Current selection */}
        <View style={styles.currentCard}>
          <Text style={styles.currentLabel}>Current</Text>
          <Text style={[styles.currentValue, !currentModel && styles.placeholder]} numberOfLines={1}>
            {currentModel
              ? currentVariant
                ? `${currentModel} · ${currentVariant}`
                : currentModel
              : 'No model configured'}
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchField}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by id, name or provider"
            placeholderTextColor={theme.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          {query !== '' && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={styles.clearGlyph}>✕</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.countCaption}>
          {filtered.length === availableModels.length
            ? `${availableModels.length} models`
            : `${filtered.length} of ${availableModels.length} models`}
        </Text>

        {/* Model list */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          maxToRenderPerBatch={16}
          windowSize={9}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSel = item.id === selectedId;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.modelRow,
                  isSel && styles.modelRowSelected,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => handleSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.name}`}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.modelId} numberOfLines={1}>
                    {item.id}
                  </Text>
                </View>
                <Text style={styles.provider}>{item.provider}</Text>
                {isSel && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No models match “{query.trim()}”.</Text>
              <Text style={styles.emptyHint}>Try a shorter search term.</Text>
            </View>
          }
        />

        {/* Variant chips + confirm */}
        {!!selectedOption && selectedOption.variants.length > 0 && (
          <View style={styles.variantBlock}>
            <Text style={styles.variantTitle}>Variant</Text>
            <View style={styles.chipWrap}>
              {selectedOption.variants.map((v) => {
                const active = v === selectedVariant;
                return (
                  <Pressable
                    key={v}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => setSelectedVariant(v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${v} variant`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {actionError != null && (
          <Text style={styles.actionError} numberOfLines={2}>
            Couldn’t save — {actionError}
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            (!canConfirm || saving) && styles.confirmDisabled,
            pressed && canConfirm && styles.confirmPressed,
          ]}
          onPress={() => void handleConfirm()}
          disabled={!canConfirm || saving}
          accessibilityRole="button"
          accessibilityLabel={`Set model to ${selectedOption?.id ?? 'selection'}`}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.confirmText}>
              {selectedOption ? `Use ${selectedOption.id}` : 'Select a model'}
            </Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
    currentCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      gap: 2,
    },
    currentLabel: {
      ...theme.type.caption,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textTertiary,
    },
    currentValue: {
      ...theme.type.body,
      fontWeight: '500',
      color: theme.colors.textPrimary,
    },
    placeholder: {
      color: theme.colors.textTertiary,
    },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.md,
      height: 42,
    },
    searchGlyph: {
      fontSize: 16,
      color: theme.colors.textTertiary,
    },
    searchInput: {
      flex: 1,
      ...theme.type.body,
      color: theme.colors.textPrimary,
      paddingVertical: 0,
    },
    clearGlyph: {
      fontSize: 13,
      color: theme.colors.textTertiary,
    },
    countCaption: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textTertiary,
      marginTop: -4,
    },
    listContent: {
      paddingBottom: theme.spacing.lg,
      gap: theme.spacing.xs,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    modelRowSelected: {
      borderColor: `${theme.colors.accent}80`,
      backgroundColor: `${theme.colors.accent}0F`,
    },
    rowPressed: {
      opacity: 0.8,
    },
    modelInfo: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    modelName: {
      ...theme.type.body,
      fontWeight: '500',
      color: theme.colors.textPrimary,
    },
    modelId: {
      ...theme.type.caption,
      fontSize: 11,
      fontFamily: 'monospace',
      color: theme.colors.textTertiary,
    },
    provider: {
      ...theme.type.caption,
      fontSize: 11,
      color: theme.colors.textSecondary,
    },
    check: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.accent,
    },
    emptyWrap: {
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.xxl,
    },
    emptyText: {
      ...theme.type.body,
      color: theme.colors.textSecondary,
    },
    emptyHint: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
    },
    variantBlock: {
      gap: theme.spacing.sm,
    },
    variantTitle: {
      ...theme.type.caption,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: theme.colors.textTertiary,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    chip: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    chipActive: {
      borderColor: `${theme.colors.accent}80`,
      backgroundColor: `${theme.colors.accent}1F`,
    },
    chipText: {
      ...theme.type.caption,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    chipTextActive: {
      color: theme.colors.accent,
      fontWeight: '600',
    },
    actionError: {
      ...theme.type.caption,
      color: theme.stateColors.error,
    },
    confirmBtn: {
      height: 48,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.lg,
    },
    confirmPressed: {
      opacity: 0.85,
    },
    confirmDisabled: {
      opacity: 0.45,
    },
    confirmText: {
      ...theme.type.headline,
      color: '#FFFFFF',
    },
  });
