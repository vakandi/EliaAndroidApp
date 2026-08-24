/**
 * Schedule projection — pure, unit-testable occurrence math for the
 * Calendar tab. Given a subworker's schedule info and a target day,
 * returns the concrete run times (hour + minute) that fall on that day.
 *
 * Server contract (subworkers/server/app/config/models.py):
 * - interval → IntervalSchedule { hours: number[] (0-23), minute: number }
 *   → runs every day at each listed hour, `minute` minutes past.
 * - cron → CronSchedule { expression } — standard 5-field cron
 *   (minute hour dom month dow; dow 0=Sunday; supports *, N, a-b,
 *   comma lists, and step forms like star/15).
 * - No scheduleType/detail → fall back to the single nextRun timestamp.
 */
import type { ScheduleDetail } from './types';

export interface Occurrence {
  hour: number;
  minute: number;
}

export interface SchedulableInfo {
  scheduleType: string | null;
  scheduleDetail?: ScheduleDetail | null;
  nextRun: string | null;
}

interface ParsedCron {
  minutes: number[];
  hours: number[];
  /** null = field was '*' (unrestricted). */
  daysOfMonth: number[] | null;
  months: number[] | null;
  daysOfWeek: number[] | null;
}

// ---------------------------------------------------------------------------
// Cron field parsing
// ---------------------------------------------------------------------------

function expandRangePart(part: string, min: number, max: number): number[] | null {
  const stepSplit = part.split('/', 2);
  const base = stepSplit[0];
  const step = stepSplit.length === 2 ? Number(stepSplit[1]) : 1;
  if (!Number.isInteger(step) || step < 1) return null;

  let lo: number;
  let hi: number;
  if (base === '*') {
    lo = min;
    hi = max;
  } else if (base.includes('-')) {
    const bounds = base.split('-', 2);
    lo = Number(bounds[0]);
    hi = Number(bounds[1]);
  } else {
    lo = Number(base);
    hi = stepSplit.length === 2 ? max : lo;
  }
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  if (lo < min || hi > max || lo > hi) return null;

  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

/** Parse one cron field into its value set; null when malformed. */
export function parseCronField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const term of field.split(',')) {
    const expanded = expandRangePart(term.trim(), min, max);
    if (expanded === null) return null;
    expanded.forEach((v) => values.add(v));
  }
  return [...values].sort((a, b) => a - b);
}

/** Parse a 5-field cron expression; null when malformed. */
export function parseCronExpression(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  // Accept 7 as Sunday alongside 0 (common cron extension).
  let daysOfWeek = parseCronField(fields[4], 0, 7);
  if (minutes === null || hours === null || daysOfMonth === null || months === null || daysOfWeek === null) {
    return null;
  }
  if (daysOfWeek.includes(7)) {
    daysOfWeek = [...new Set(daysOfWeek.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
  }
  return {
    minutes,
    hours,
    daysOfMonth: fields[2] === '*' ? null : daysOfMonth,
    months: fields[3] === '*' ? null : months,
    daysOfWeek: fields[4] === '*' ? null : daysOfWeek,
  };
}

/**
 * Standard cron day matching: when both dom and dow are restricted, a day
 * matches if EITHER matches; otherwise every restricted field must match.
 */
export function cronMatchesDate(cron: ParsedCron, date: Date): boolean {
  if (cron.months !== null && !cron.months.includes(date.getMonth() + 1)) return false;

  const domMatch = cron.daysOfMonth?.includes(date.getDate()) ?? false;
  const dowMatch = cron.daysOfWeek?.includes(date.getDay()) ?? false;
  if (cron.daysOfMonth !== null && cron.daysOfWeek !== null) {
    return domMatch || dowMatch;
  }
  if (cron.daysOfMonth !== null) return domMatch;
  if (cron.daysOfWeek !== null) return dowMatch;
  return true;
}

// ---------------------------------------------------------------------------
// Day projection
// ---------------------------------------------------------------------------

function occurrencesFromSets(hours: number[], minute: number): Occurrence[] {
  return hours
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    .map((h) => ({ hour: h, minute }))
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

function dedupe(occurrences: Occurrence[]): Occurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((o) => {
    const key = `${o.hour}:${o.minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nextRunOccurrence(info: SchedulableInfo, day: Date): Occurrence[] {
  if (!info.nextRun) return [];
  const t = Date.parse(info.nextRun);
  if (Number.isNaN(t)) return [];
  const d = new Date(t);
  if (
    d.getFullYear() !== day.getFullYear() ||
    d.getMonth() !== day.getMonth() ||
    d.getDate() !== day.getDate()
  ) {
    return [];
  }
  return [{ hour: d.getHours(), minute: d.getMinutes() }];
}

/**
 * All run times on `day` for one subworker.
 * interval/cron project recurring occurrences across any day; anything
 * unparsable falls back to the single nextRun timestamp (when it lands
 * on `day`).
 */
export function projectDayOccurrences(info: SchedulableInfo, day: Date): Occurrence[] {
  if (!info.scheduleType) return nextRunOccurrence(info, day);

  const detail = info.scheduleDetail;
  if (!detail) return nextRunOccurrence(info, day);

  if (info.scheduleType === 'interval') {
    if (!detail.hours || detail.hours.length === 0) return nextRunOccurrence(info, day);
    const minute = typeof detail.minute === 'number' ? detail.minute : 0;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return nextRunOccurrence(info, day);
    return occurrencesFromSets(detail.hours, minute);
  }

  if (info.scheduleType === 'cron') {
    if (!detail.expression) return nextRunOccurrence(info, day);
    const cron = parseCronExpression(detail.expression);
    if (!cron) return nextRunOccurrence(info, day);
    if (!cronMatchesDate(cron, day)) return [];
    const out: Occurrence[] = [];
    for (const hour of cron.hours) {
      for (const minute of cron.minutes) out.push({ hour, minute });
    }
    return dedupe(out).sort((a, b) => a.hour - b.hour || a.minute - b.minute);
  }

  return nextRunOccurrence(info, day);
}
