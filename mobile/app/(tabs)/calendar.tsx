/**
 * Calendar tab — weekly schedule view (PLAN.md §8 J).
 * Google-Calendar-style week grid: 7 day columns × 24 hour rows, today's
 * column highlighted with a live "now" line. Every enabled agent's schedule
 * is PROJECTED across the visible week (interval hours / cron expression via
 * scheduleProjection; nextRun-only fallback for agents without detail), each
 * occurrence plotted as a state-colored chip (monogram). Tapping a chip
 * opens that agent's chat page — when several agents share the slot, a
 * bottom-sheet chooser lists them first. Day summary header counts the
 * projected runs for the selected day.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AgentCollisionSheet } from '@/src/components/AgentCollisionSheet';
import { deriveAgentState, monogramFor } from '@/src/components/AgentRow';
import { SubworkerApi } from '@/src/lib/api';
import { projectDayOccurrences } from '@/src/lib/scheduleProjection';
import { useSettingsStore } from '@/src/lib/settings';
import { useSubworkersStore } from '@/src/lib/store';
import type { AgentState, SubworkerInfo } from '@/src/lib/types';
import { useTheme, type Theme } from '@/src/theme';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const HOUR_HEIGHT = 56;
const GUTTER_WIDTH = 44;
const GRID_HEIGHT = 24 * HOUR_HEIGHT;
const CHIP_HEIGHT = 26;
const CHIP_GAP = 3;
const DAY_MS = 86_400_000;

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---------------------------------------------------------------------------
// Date helpers (local to this screen — shared lib untouched per unit scope)
// ---------------------------------------------------------------------------

function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - d.getDay()); // week starts Sunday (matches getDay())
  return d;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "9 AM" / "2 PM" gutter labels; midnight omitted (clipped at grid top). */
function hourLabel(hour: number): string {
  if (hour === 0) return '';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function weekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const startPart = `${MONTH_ABBR[weekStart.getMonth()]} ${weekStart.getDate()}`;
  const endPart =
    weekEnd.getMonth() === weekStart.getMonth()
      ? `${weekEnd.getDate()}`
      : `${MONTH_ABBR[weekEnd.getMonth()]} ${weekEnd.getDate()}`;
  return `${startPart} – ${endPart}`;
}

function formatTimeOfDay(date: Date): string {
  const h = date.getHours();
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${date.getMinutes() < 10 ? '0' : ''}${date.getMinutes()} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Chip model — one plotted run per projected occurrence
// ---------------------------------------------------------------------------

interface ScheduledChip {
  key: string;
  subworker: SubworkerInfo;
  state: AgentState;
  dayIndex: number;
  hour: number;
  minute: number;
  /** Pixel offset from grid top, clamped to the visible hour range. */
  top: number;
}

interface PlacedChip extends ScheduledChip {
  x: number;
  width: number;
}

function makeChip(
  subworker: SubworkerInfo,
  dayIndex: number,
  hour: number,
  minute: number,
): ScheduledChip {
  const fractionalHours = hour + minute / 60;
  const top = Math.min(Math.max(fractionalHours, 0), 24) * HOUR_HEIGHT - CHIP_HEIGHT / 2;
  return {
    key: `${subworker.id}:d${dayIndex}h${hour}m${minute}`,
    subworker,
    state: deriveAgentState(subworker),
    dayIndex,
    hour,
    minute,
    top: Math.min(Math.max(top, 0), GRID_HEIGHT - CHIP_HEIGHT),
  };
}

/** Projected occurrences for all enabled agents; next_run-only fallback. */
function buildChips(subworkers: SubworkerInfo[], weekStart: Date): ScheduledChip[] {
  const chips: ScheduledChip[] = [];
  for (const sw of subworkers) {
    if (!sw.enabled) continue;

    if (sw.scheduleType != null) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const day = addDays(weekStart, dayIndex);
        for (const occ of projectDayOccurrences(sw, day)) {
          chips.push(makeChip(sw, dayIndex, occ.hour, occ.minute));
        }
      }
      continue;
    }

    // No schedule detail from server → next_run only.
    if (!sw.nextRun) continue;
    const t = Date.parse(sw.nextRun);
    if (Number.isNaN(t)) continue;
    const runDate = new Date(t);
    const dayStart = new Date(
      runDate.getFullYear(),
      runDate.getMonth(),
      runDate.getDate(),
    );
    const dayIndex = Math.round((dayStart.getTime() - weekStart.getTime()) / DAY_MS);
    if (dayIndex < 0 || dayIndex > 6) continue;
    chips.push(makeChip(sw, dayIndex, runDate.getHours(), runDate.getMinutes()));
  }
  return chips.sort((a, b) => a.dayIndex - b.dayIndex || a.top - b.top);
}

/**
 * Greedy clustering: visually-overlapping chips in one day share the column
 * width evenly (Google Calendar lane behavior, simplified).
 */
function placeChips(dayChips: ScheduledChip[], dayIndex: number, colWidth: number): PlacedChip[] {
  const placed: PlacedChip[] = [];
  let cluster: ScheduledChip[] = [];
  let clusterBottom = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const slotWidth = (colWidth - CHIP_GAP * (cluster.length - 1)) / cluster.length;
    cluster.forEach((chip, i) => {
      placed.push({
        ...chip,
        x: dayIndex * colWidth + i * (slotWidth + CHIP_GAP),
        width: slotWidth,
      });
    });
    cluster = [];
  };

  for (const chip of dayChips) {
    if (cluster.length > 0 && chip.top >= clusterBottom) flush();
    cluster.push(chip);
    clusterBottom = chip.top + CHIP_HEIGHT;
  }
  flush();
  return placed;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CalendarScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const subworkers = useSubworkersStore((s) => s.subworkers);
  const isLoading = useSubworkersStore((s) => s.isLoading);
  const statusError = useSubworkersStore((s) => s.statusError);
  const refreshNow = useSubworkersStore((s) => s.refreshNow);

  const [refreshing, setRefreshing] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedOffset, setSelectedOffset] = useState(() => new Date().getDay());
  const [gridWidth, setGridWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const today = useMemo(() => new Date(), []);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const selectedDate = weekDays[selectedOffset] ?? weekDays[0];

  const chips = useMemo(() => buildChips(subworkers, weekStart), [subworkers, weekStart]);

  const placedByDay = useMemo(() => {
    if (gridWidth <= 0) return [] as PlacedChip[][];
    const colWidth = gridWidth / 7;
    return Array.from({ length: 7 }, (_, day) =>
      placeChips(chips.filter((c) => c.dayIndex === day), day, colWidth),
    );
  }, [chips, gridWidth]);

  const todayIndex = useMemo(() => {
    if (!isSameDay(today, weekStart) && today < weekStart) return -1;
    if (today.getTime() > addDays(weekStart, 7).getTime()) return -1;
    return Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - weekStart.getTime()) / DAY_MS);
  }, [today, weekStart]);

  const nowTop = useMemo(() => {
    const fractional = today.getHours() + today.getMinutes() / 60;
    return fractional * HOUR_HEIGHT;
  }, [today]);

  // Auto-scroll to shortly above the current time, like Google Calendar.
  useEffect(() => {
    if (gridWidth <= 0) return;
    const target = todayIndex >= 0 ? Math.max(nowTop - HOUR_HEIGHT * 2, 0) : 0;
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, [gridWidth, nowTop, todayIndex]);

  const dayCount = chips.filter((c) => c.dayIndex === selectedOffset).length;
  const onCurrentWeek = todayIndex >= 0;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshNow();
    } catch {
      // Connection issues surface through statusError.
    } finally {
      setRefreshing(false);
    }
  }, [refreshNow]);

  const [collision, setCollision] = useState<{
    slotLabel: string;
    agents: SubworkerInfo[];
  } | null>(null);

  const navigateToAgentChat = useCallback(
    async (name: string) => {
      let sessionId: string | null = null;
      try {
        const api = new SubworkerApi(
          () => useSettingsStore.getState().serverUrl,
          () => useSettingsStore.getState().authToken,
        );
        const sessions = await api.getSessionsList(name);
        sessionId = sessions[0]?.sessionId ?? null;
      } catch {
        sessionId = null;
      }
      const query = sessionId
        ? `?chats=1&session=${encodeURIComponent(sessionId)}`
        : '?chats=1';
      router.push(`/agent/${encodeURIComponent(name)}${query}`);
    },
    [router],
  );

  const handleChipPress = useCallback(
    (chip: ScheduledChip) => {
      const agents: SubworkerInfo[] = [];
      const seen = new Set<string>();
      for (const c of chips) {
        if (c.dayIndex !== chip.dayIndex || c.hour !== chip.hour) continue;
        if (seen.has(c.subworker.name)) continue;
        seen.add(c.subworker.name);
        agents.push(c.subworker);
      }

      if (agents.length <= 1) {
        void navigateToAgentChat(chip.subworker.name);
        return;
      }

      const day = addDays(weekStart, chip.dayIndex);
      const slotTime = formatTimeOfDay(
        new Date(day.getFullYear(), day.getMonth(), day.getDate(), chip.hour, chip.minute),
      );
      setCollision({
        slotLabel: `${WEEKDAY_ABBR[day.getDay()]}, ${MONTH_ABBR[day.getMonth()]} ${day.getDate()} · ${slotTime}`,
        agents,
      });
    },
    [chips, weekStart, navigateToAgentChat],
  );

  const goToDate = useCallback((date: Date) => {
    setWeekStart(startOfWeek(date));
    setSelectedOffset(date.getDay());
  }, []);

  if (isLoading && subworkers.length === 0) {
    return (
      <View style={[styles.screen, styles.stateWrap]}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={styles.stateTitle}>Connecting to server…</Text>
        <Text style={styles.stateCaption}>Loading your agents' schedule.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Day summary header */}
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle}>
              {isSameDay(selectedDate, today)
                ? 'Today'
                : `${WEEKDAY_ABBR[selectedDate.getDay()]}, ${MONTH_ABBR[selectedDate.getMonth()]} ${selectedDate.getDate()}`}
            </Text>
            <Text style={styles.summaryCaption}>
              {dayCount === 0
                ? 'No runs scheduled'
                : `${dayCount} run${dayCount === 1 ? '' : 's'} scheduled`}
            </Text>
          </View>
          <Text style={styles.weekLabel}>{weekLabel(weekStart)}</Text>
        </View>
        <View style={styles.pagerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            onPress={() => goToDate(addDays(weekStart, -7))}
            style={styles.pagerButton}
          >
            <Text style={styles.pagerGlyph}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to current week"
            onPress={() => goToDate(new Date())}
            style={[styles.pagerButton, !onCurrentWeek && styles.pagerButtonAccent]}
          >
            <Text style={[styles.pagerToday, !onCurrentWeek && styles.pagerTodayActive]}>
              Today
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next week"
            onPress={() => goToDate(addDays(weekStart, 7))}
            style={styles.pagerButton}
          >
            <Text style={styles.pagerGlyph}>›</Text>
          </Pressable>
        </View>
        {statusError != null && (
          <View style={styles.errorBanner}>
            <View style={styles.errorDot} />
            <Text style={styles.errorBannerText} numberOfLines={2}>
              {statusError}
            </Text>
          </View>
        )}
      </View>

      {/* Day-of-week header */}
      <View style={styles.dayHeaderRow}>
        <View style={{ width: GUTTER_WIDTH }} />
        {weekDays.map((date, i) => {
          const isToday = i === todayIndex;
          const isSelected = i === selectedOffset;
          return (
            <Pressable
              key={date.toISOString()}
              accessibilityRole="button"
              accessibilityLabel={`${WEEKDAY_ABBR[date.getDay()]} ${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`}
              onPress={() => setSelectedOffset(i)}
              style={styles.dayHeaderCell}
            >
              <Text style={[styles.dayHeaderText, isToday && styles.dayHeaderTextToday]}>
                {WEEKDAY_ABBR[date.getDay()].toUpperCase()}
              </Text>
              <View
                style={[
                  styles.dayNumber,
                  isSelected && !isToday && styles.dayNumberSelected,
                  isToday && styles.dayNumberToday,
                ]}
              >
                <Text
                  style={[
                    styles.dayNumberText,
                    isSelected && !isToday && styles.dayNumberTextSelected,
                    isToday && styles.dayNumberTextToday,
                  ]}
                >
                  {date.getDate()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Week grid */}
      <ScrollView
        ref={scrollRef}
        style={styles.gridScroll}
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
      >
        <View style={styles.gridBody}>
          {/* Hour gutter */}
          <View style={{ width: GUTTER_WIDTH, height: GRID_HEIGHT }}>
            {Array.from({ length: 24 }, (_, hour) =>
              hour === 0 ? null : (
                <Text
                  key={hour}
                  style={[styles.hourLabel, { top: hour * HOUR_HEIGHT - 7 }]}
                >
                  {hourLabel(hour)}
                </Text>
              ),
            )}
          </View>

          {/* Relative canvas: hour lines, day separators, chips, now-line */}
          <View
            style={{ flex: 1, height: GRID_HEIGHT }}
            onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <View key={hour} style={[styles.hourLine, { top: hour * HOUR_HEIGHT }]} />
            ))}
            {Array.from({ length: 6 }, (_, i) => (
              <View
                key={`sep-${i}`}
                style={[styles.daySeparator, { left: ((i + 1) * gridWidth) / 7 }]}
              />
            ))}

            {/* Today column tint + live now-line */}
            {todayIndex >= 0 && gridWidth > 0 && (
              <>
                <View
                  style={[
                    styles.todayColumn,
                    {
                      left: (todayIndex * gridWidth) / 7,
                      width: gridWidth / 7,
                      backgroundColor: `${theme.colors.accent}0D`,
                    },
                  ]}
                />
                <View
                  style={[styles.nowLine, { top: nowTop, left: (todayIndex * gridWidth) / 7 + 2, width: gridWidth / 7 - 4 }]}
                >
                  <View style={[styles.nowDot, { backgroundColor: theme.colors.accent }]} />
                </View>
              </>
            )}

            {/* Run chips */}
            {placedByDay.map((dayPlaced, day) =>
              dayPlaced.map((chip) => (
                <Pressable
                  key={chip.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${chip.subworker.name}, ${WEEKDAY_ABBR[day]} ${formatTimeOfDay(new Date(weekDays[day].getFullYear(), weekDays[day].getMonth(), weekDays[day].getDate(), chip.hour, chip.minute))}`}
                  onPress={() => handleChipPress(chip)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      left: chip.x,
                      top: chip.top,
                      width: chip.width,
                      backgroundColor: theme.stateColors[chip.state],
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={styles.chipMonogram} numberOfLines={1}>
                    {monogramFor(chip.subworker.name)}
                  </Text>
                </Pressable>
              )),
            )}

            {/* Empty-week hint floats over the grid without hiding it */}
            {chips.length === 0 && (
              <View pointerEvents="none" style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>No runs scheduled this week.</Text>
                <Text style={styles.emptyHintCaption}>
                  Enable an agent and its scheduled runs appear here.
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <AgentCollisionSheet
        visible={collision != null}
        slotLabel={collision?.slotLabel ?? ''}
        agents={collision?.agents ?? []}
        onClose={() => setCollision(null)}
        onPick={(name) => {
          setCollision(null);
          void navigateToAgentChat(name);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },

    // Loading state
    stateWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    stateTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
      textAlign: 'center',
    },
    stateCaption: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
    },

    // Summary header
    summary: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    summaryTitle: {
      ...theme.type.headline,
      color: theme.colors.textPrimary,
    },
    summaryCaption: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    weekLabel: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      marginTop: 3,
    },
    pagerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    pagerButton: {
      minHeight: 32,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pagerGlyph: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    pagerToday: {
      ...theme.type.caption,
      color: theme.colors.textPrimary,
    },
    pagerButtonAccent: {
      borderColor: 'transparent',
      backgroundColor: `${theme.colors.accent}14`,
    },
    pagerTodayActive: {
      color: theme.colors.accent,
      fontWeight: '600',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: 'rgba(239, 68, 68, 0.10)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(239, 68, 68, 0.35)',
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    errorDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.stateColors.error,
    },
    errorBannerText: {
      ...theme.type.caption,
      flex: 1,
      color: theme.stateColors.error,
    },

    // Day-of-week header
    dayHeaderRow: {
      flexDirection: 'row',
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    dayHeaderCell: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    dayHeaderText: {
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 0.4,
      color: theme.colors.textTertiary,
    },
    dayHeaderTextToday: {
      color: theme.colors.accent,
    },
    dayNumber: {
      minWidth: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    dayNumberSelected: {
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    dayNumberToday: {
      backgroundColor: theme.colors.accent,
    },
    dayNumberText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    dayNumberTextSelected: {
      color: theme.colors.textSecondary,
    },
    dayNumberTextToday: {
      color: '#FFFFFF',
    },

    // Grid
    gridScroll: {
      flex: 1,
    },
    gridBody: {
      flexDirection: 'row',
    },
    hourLabel: {
      position: 'absolute',
      right: theme.spacing.sm,
      fontSize: 10,
      color: theme.colors.textTertiary,
    },
    hourLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    daySeparator: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    todayColumn: {
      position: 'absolute',
      top: 0,
      height: GRID_HEIGHT,
    },
    nowLine: {
      position: 'absolute',
      height: 2,
      borderRadius: 1,
      backgroundColor: theme.colors.accent,
      flexDirection: 'row',
      alignItems: 'center',
    },
    nowDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginLeft: -2,
    },

    // Chips
    chip: {
      position: 'absolute',
      height: CHIP_HEIGHT,
      borderRadius: theme.radius.sm - 3, // 7px pill-ish radius at small scale
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOpacity: 0.15,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    chipMonogram: {
      fontSize: 10,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.3,
    },

    // Empty hint
    emptyHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: HOUR_HEIGHT * 6,
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.xl,
    },
    emptyHintText: {
      ...theme.type.body,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    emptyHintCaption: {
      ...theme.type.caption,
      color: theme.colors.textTertiary,
      textAlign: 'center',
    },
  });
