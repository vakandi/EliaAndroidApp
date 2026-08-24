import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/src/theme';

function TabIcon({ glyph, color, size }: { glyph: string; color: ColorValue; size: number }) {
  return <Text style={{ fontSize: size * 0.9, color, lineHeight: size * 1.1 }}>{glyph}</Text>;
}

/** Bottom tabs: Home | Agents | Calendar | Settings (PLAN.md §3 + §8 J). */
export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { ...theme.type.title, color: theme.colors.textPrimary },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: theme.type.caption,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <TabIcon glyph="⌂" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: 'Agents',
          tabBarIcon: ({ color, size }) => <TabIcon glyph="🤖" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color, size }) => <TabIcon glyph="📅" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <TabIcon glyph="⚙️" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
