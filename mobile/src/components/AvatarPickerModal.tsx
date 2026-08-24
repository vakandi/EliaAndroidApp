/**
 * AvatarPickerModal — pick or remove an agent's profile photo (PLAN.md §8 K).
 * Launches the system photo library with a square crop (aspect [1,1]), copies
 * the result into app storage via profilePhotos.setPhoto, and offers a
 * remove-photo action when one is already set.
 */
import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { hasPhoto, removePhoto, setPhoto } from '@/src/lib/profilePhotos';
import { useTheme, type Theme } from '@/src/theme';

interface AvatarPickerModalProps {
  visible: boolean;
  agentName: string;
  onClose: () => void;
}

export function AvatarPickerModal({
  visible,
  agentName,
  onClose,
}: AvatarPickerModalProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [hasCurrent, setHasCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state + resolve current-photo presence on each open.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(false);
    setHasCurrent(false);
    let alive = true;
    void hasPhoto(agentName).then((exists) => {
      if (alive) setHasCurrent(exists);
    });
    return () => {
      alive = false;
    };
  }, [visible, agentName]);

  const handleChoose = async (): Promise<void> => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo access is off. Allow it in system Settings to continue.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const stored = await setPhoto(agentName, asset.uri, {
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
      });
      if (stored === null) {
        setError("Couldn't save that photo. Try a different one.");
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await removePhoto(agentName);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Profile photo</Text>
          <View style={styles.previewWrap}>
            <Avatar name={agentName} size={96} />
          </View>
          <Text numberOfLines={1} style={styles.agentName}>
            {agentName}
          </Text>

          {error !== null && (
            <Text style={[styles.hint, { color: theme.stateColors.error }]}>
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={() => void handleChoose()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Choose a new photo for ${agentName}`}
              accessibilityState={{ busy }}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.colors.accent },
                busy && styles.buttonDisabled,
                pressed && !busy && styles.pressedStrong,
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {hasCurrent ? 'Choose new photo' : 'Choose photo'}
                </Text>
              )}
            </Pressable>

            {hasCurrent && (
              <Pressable
                onPress={() => void handleRemove()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo for ${agentName}`}
                style={({ pressed }) => [
                  styles.destructiveButton,
                  busy && styles.buttonDisabled,
                  pressed && !busy && styles.pressedSoft,
                ]}
              >
                <Text style={[styles.destructiveButtonText, { color: theme.stateColors.error }]}>
                  Remove photo
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.pressedSoft,
              ]}
            >
              <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.lg,
    },
    dialog: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      textAlign: 'center',
    },
    previewWrap: {
      alignItems: 'center',
      paddingTop: theme.spacing.md,
    },
    agentName: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textTertiary,
      textAlign: 'center',
    },
    hint: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: 'center',
    },
    actions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    primaryButton: {
      minHeight: 46,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
    },
    destructiveButton: {
      minHeight: 44,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    destructiveButtonText: {
      fontSize: 15,
      fontWeight: '500',
    },
    cancelButton: {
      minHeight: 44,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    cancelButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    pressedSoft: {
      opacity: 0.55,
    },
    pressedStrong: {
      opacity: 0.8,
    },
  });
