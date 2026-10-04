import { expect, it } from 'vitest';
import { tripState, groupHref } from './discovery';
it('uses inclusive server date boundaries without restricting financial dates', () => {
  const trip = { startDate: '2026-10-04', endDate: '2026-10-06' };
  expect(tripState(trip, '2026-10-03')).toBe('Upcoming');
  expect(tripState(trip, '2026-10-04')).toBe('In progress');
  expect(tripState(trip, '2026-10-06')).toBe('In progress');
  expect(tripState(trip, '2026-10-07')).toBe('Past');
  expect(groupHref('typed/id')).toBe('/groups/typed%2Fid');
});
