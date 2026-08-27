/**
 * Local notifications for subworker lifecycle events.
 * Driven purely by WebSocket events (subworker_started / completed / error) —
 * no polling involved. Master toggle lives in Settings → Notifications.
 *
 * Android notes:
 * - Channel importance HIGH is required for heads-up banner + sound while
 *   the app is in background. DEFAULT is silent on many OEMs.
 * - Immediate trigger (trigger: null) is used — no 1s delay, no exact-alarm
 *   permission needed. SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM are NOT required.
 * - POST_NOTIFICATIONS is a runtime permission on Android 13+ (API 33) — the
 *   plugin declares it and initNotifications() requests it on first launch.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { useSettingsStore } from './settings';

const CHANNEL_ID = 'subworker-events';

let configured = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initNotifications(): Promise<void> {
  if (configured) return;
  configured = true;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Subworker events',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10A37F',
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Permission check must never crash startup.
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  } catch {
    return false;
  }
}

async function post(title: string, body: string): Promise<void> {
  if (!useSettingsStore.getState().notificationsEnabled) return;
  try {
    // Trigger null = immediate local notification. Avoids TIME_INTERVAL
    // which requires SCHEDULE_EXACT_ALARM on Android 14+ and is unreliable
    // for sub-second delivery. Channel banner works even when app is backgrounded.
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch {
    // Notification failures must never break the store's event handling.
  }
}

export function notifySubworkerStarted(name: string): void {
  void post(`▶ ${name} started`, 'The run is now in progress.');
}

export function notifySubworkerCompleted(name: string): void {
  void post(`✓ ${name} finished`, 'The run completed successfully.');
}

export function notifySubworkerError(name: string, error: string): void {
  void post(`✗ ${name} failed`, error || 'The run ended with an error.');
}
