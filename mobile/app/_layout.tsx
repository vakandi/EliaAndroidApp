import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { useSettingsStore } from '@/src/lib/settings';
import { initNotifications } from '@/src/lib/notifications';
import { useSubworkersStore } from '@/src/lib/store';

/**
 * Root layout: starts the application-scoped subworker store once the
 * persisted settings have rehydrated (PLAN.md §2 — store survives tab switches).
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrated = useSettingsStore((s) => s.hydrated);

  useEffect(() => {
    void initNotifications();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const store = useSubworkersStore.getState();
    store.start();
    return () => {
      store.stop();
    };
  }, [hydrated]);

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="agent/[name]" />
      </Stack>
    </>
  );
}
