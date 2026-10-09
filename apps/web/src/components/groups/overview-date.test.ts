import { expect, it } from 'vitest';
import {
  overviewDate,
  overviewPeriod,
  overviewSpansYears,
} from './overview-date';
it('labels the actual calendar range and preserves a single month when appropriate', () => {
  expect(overviewPeriod(['2026-10-08', '2026-10-01'])).toBe('October 2026');
  expect(overviewPeriod(['2026-10-08', '2026-09-30'])).toBe(
    'September 2026 – October 2026',
  );
  expect(overviewPeriod(['2026-10-08', '2025-09-07'])).toBe(
    'September 2025 – October 2026',
  );
  expect(overviewPeriod([])).toBe('');
});
it('includes the year for a recent list spanning years without shifting stored dates', () => {
  const dates = ['2026-10-08', '2025-09-07'];
  expect(overviewSpansYears(dates)).toBe(true);
  expect(overviewDate(dates[1], false, overviewSpansYears(dates))).toBe(
    'Sep 7, 2025',
  );
  expect(overviewDate('2026-01-01')).toBe('Jan 1');
  expect(overviewSpansYears(['2026-01-01', '2026-12-31'])).toBe(false);
});
