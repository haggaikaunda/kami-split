import { expect, it } from 'vitest';
import { tripState, groupHref, financialReturn } from './discovery';
it('uses inclusive server date boundaries without restricting financial dates', () => {
  const trip = { startDate: '2026-10-04', endDate: '2026-10-06' };
  expect(tripState(trip, '2026-10-03')).toBe('Upcoming');
  expect(tripState(trip, '2026-10-04')).toBe('In progress');
  expect(tripState(trip, '2026-10-06')).toBe('In progress');
  expect(tripState(trip, '2026-10-07')).toBe('Past');
  expect(groupHref('typed/id')).toBe('/groups/typed%2Fid');
});

it('preserves canonical deep links through sign-in and rejects external return targets', () => {
  expect(financialReturn('/groups/G/expenses/E')).toBe('/groups/G/expenses/E');
  for (const value of [
    'https://evil.test',
    '//evil.test',
    '/account',
    '/groups/G?next=bad',
    null,
  ])
    expect(financialReturn(value)).toBe('/groups');
});

it('preserves authorized workspace and specific repayment paths without external query targets', () => {
  expect(financialReturn('/groups/G?tab=balances')).toBe(
    '/groups/G?tab=balances',
  );
  expect(
    financialReturn(
      '/groups/G/repayments/new?sender=A&recipient=B&amount=1001',
    ),
  ).toBe('/groups/G/repayments/new?sender=A&recipient=B&amount=1001');
  expect(
    financialReturn('/groups/G/repayments/new?next=https://evil.test'),
  ).toBe('/groups');
});
