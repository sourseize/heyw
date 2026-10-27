/**
 * Time model for HeyWork.
 *
 *  - Every instant is persisted as an ISO-8601 UTC string.
 *  - Calendar values (YYYY-MM-DD days, YYYY-MM months) are expressed in the
 *    user's IANA time zone, supplied by the client (`?tz=`).
 *  - This module is the only place that converts between the two. It relies
 *    solely on `Intl.DateTimeFormat`, which is built into Node (no deps).
 */

export const DEFAULT_TZ = 'UTC';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** True when `tz` is an IANA zone that this Node build can format in. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Returns `tz` when valid, otherwise the default (UTC). */
export function resolveTimeZone(tz: unknown): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;
  second: number;
}

/** Breaks an instant into wall-clock parts in the given zone. */
export function partsInZone(instant: string | Date, tz: string): ZonedParts {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid instant: ${String(instant)}`);
  }
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant, as seen in `tz`. */
export function dateInZone(instant: string | Date, tz: string): string {
  const p = partsInZone(instant, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** `YYYY-MM` of an instant, as seen in `tz`. */
export function monthInZone(instant: string | Date, tz: string): string {
  return dateInZone(instant, tz).slice(0, 7);
}

/** Today's `YYYY-MM-DD` in `tz`. `now` is injectable for tests. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  return dateInZone(now, tz);
}

// ── Pure calendar arithmetic on YYYY-MM-DD strings (zone-independent) ──

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidMonthString(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Adds `n` days (may be negative) to a `YYYY-MM-DD` string. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, for a `YYYY-MM-DD` string. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Number of days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Previous / next `YYYY-MM`. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}
