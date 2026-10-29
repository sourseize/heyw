import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, dateInZone, dayOfWeek, daysInMonth, isValidDateString, isValidMonthString,
  isValidTimeZone, monthInZone, partsInZone, resolveTimeZone, todayInZone,
} from '../../db/time.js';

test('time - validates IANA zones and falls back to UTC', () => {
  assert.equal(isValidTimeZone('Europe/Amsterdam'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(resolveTimeZone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(resolveTimeZone('nope'), 'UTC');
});

test('time - the same instant lands on different calendar days per zone', () => {
  const instant = '2025-03-31T23:30:00.000Z';
  assert.equal(dateInZone(instant, 'UTC'), '2025-03-31');
  assert.equal(dateInZone(instant, 'America/New_York'), '2025-03-31'); // 19:30 EDT
  assert.equal(dateInZone(instant, 'Europe/Amsterdam'), '2025-04-01'); // 01:30 CEST
  assert.equal(dateInZone(instant, 'Pacific/Auckland'), '2025-04-01'); // 12:30 NZDT
  assert.equal(monthInZone(instant, 'Europe/Amsterdam'), '2025-04');
  assert.equal(monthInZone(instant, 'UTC'), '2025-03');
});

test('time - parts are wall-clock in zone, with midnight as 00 not 24', () => {
  const p = partsInZone('2025-01-01T00:00:00.000Z', 'UTC');
  assert.deepEqual(p, { year: 2025, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  const ny = partsInZone('2025-07-04T16:05:09.000Z', 'America/New_York');
  assert.deepEqual(ny, { year: 2025, month: 7, day: 4, hour: 12, minute: 5, second: 9 });
  assert.throws(() => partsInZone('not-a-date', 'UTC'));
});

test('time - DST transitions do not break day bucketing', () => {
  // Europe/Amsterdam springs forward 2025-03-30 02:00 -> 03:00
  assert.equal(dateInZone('2025-03-30T00:59:00.000Z', 'Europe/Amsterdam'), '2025-03-30');
  assert.equal(dateInZone('2025-03-29T23:30:00.000Z', 'Europe/Amsterdam'), '2025-03-30');
  // falls back 2025-10-26 03:00 -> 02:00
  assert.equal(dateInZone('2025-10-25T22:30:00.000Z', 'Europe/Amsterdam'), '2025-10-26');
});

test('time - todayInZone uses injected clock', () => {
  const now = new Date('2025-03-31T23:30:00.000Z');
  assert.equal(todayInZone('UTC', now), '2025-03-31');
  assert.equal(todayInZone('Asia/Tokyo', now), '2025-04-01');
});

test('time - calendar arithmetic is zone independent and handles month/year edges', () => {
  assert.equal(addDays('2025-03-31', 1), '2025-04-01');
  assert.equal(addDays('2025-01-01', -1), '2024-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // leap year
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(dayOfWeek('2025-03-31'), 1); // Monday
  assert.equal(dayOfWeek('2025-04-06'), 0); // Sunday
  assert.equal(daysInMonth('2025-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2025-12'), 31);
  assert.equal(addMonths('2025-01', -1), '2024-12');
  assert.equal(addMonths('2025-12', 1), '2026-01');
});

test('time - string validators', () => {
  assert.equal(isValidDateString('2025-02-29'), false);
  assert.equal(isValidDateString('2024-02-29'), true);
  assert.equal(isValidDateString('2025-13-01'), false);
  assert.equal(isValidDateString('2025-3-1'), false);
  assert.equal(isValidMonthString('2025-03'), true);
  assert.equal(isValidMonthString('2025-00'), false);
  assert.equal(isValidMonthString('2025-3'), false);
});
