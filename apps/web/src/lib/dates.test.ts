import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { calendarDate, validCalendarDate, timestamp } from './dates';

it('rejects malformed Gregorian calendar dates rather than normalizing them', () => {
  for (const value of [
    '2026-02-29',
    '2026-04-31',
    '0000-01-01',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
  ]) {
    expect(validCalendarDate(value)).toBe(false);
    expect(calendarDate(value)).toBe('Date unavailable');
  }
  expect(calendarDate('2024-02-29')).toBe('Feb 29, 2024');
  expect(calendarDate('0099-01-01')).toBe('Jan 1, 99');
});

it('uses local midnight on both sides of UTC while calendar labels stay unchanged', () => {
  const datesModule = new URL('./dates.ts', import.meta.url).href;
  for (const [zone, instant, expected] of [
    ['America/Los_Angeles', '2026-10-12T06:59:59Z', '2026-10-11'],
    ['America/Los_Angeles', '2026-10-12T07:00:00Z', '2026-10-12'],
    ['Pacific/Kiritimati', '2026-10-11T09:59:59Z', '2026-10-11'],
    ['Pacific/Kiritimati', '2026-10-11T10:00:00Z', '2026-10-12'],
    ['America/Los_Angeles', '2026-03-08T09:59:59Z', '2026-03-08'],
    ['America/Los_Angeles', '2026-03-08T10:00:00Z', '2026-03-08'],
  ]) {
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {localCalendarDate,calendarDate,timestamp} from ${JSON.stringify(datesModule)}; console.log(JSON.stringify([localCalendarDate(new Date(${JSON.stringify(instant)})),calendarDate('2026-01-01'),timestamp('2026-11-01T09:30:00.123456Z')]));`,
        ],
        { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
      ),
    );
    expect(result).toEqual([
      expected,
      'Jan 1, 2026',
      'Nov 1, 2026, 9:30:00 AM UTC',
    ]);
  }
});

it('labels actual instants in UTC across daylight-saving transitions', () => {
  expect(timestamp('2026-03-08T01:59:59-08:00')).toBe(
    'Mar 8, 2026, 9:59:59 AM UTC',
  );
  expect(timestamp('2026-03-08T03:00:00-07:00')).toBe(
    'Mar 8, 2026, 10:00:00 AM UTC',
  );
  expect(timestamp('2026-11-01T01:30:00-07:00')).not.toBe(
    timestamp('2026-11-01T01:30:00-08:00'),
  );
});
