/**
 * Local notifications for subworker lifecycle events.
 * Driven purely by WebSocket events (subworker_error / subworker_completed) —
 * no polling involved. Master toggle lives in Settings → Notifications.
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
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#10A37F',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (!current.granted && current.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }
}

async function post(title: string, body: string): Promise<void> {
  if (!useSettingsStore.getState().notificationsEnabled) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger:
        Platform.OS === 'android'
          ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL_ID }
          : { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
    });
  } catch {
    // Notification failures must never break the store's event handling.
  }
}

export function notifySubworkerCompleted(name: string): void {
  void post(`✓ ${name} finished`, 'The run completed successfully.');
}

export function notifySubworkerError(name: string, error: string): void {
  void post(`✗ ${name} failed`, error || 'The run ended with an error.');
}
