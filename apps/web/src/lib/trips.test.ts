import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import {
  tripCards,
  tripDateLabel,
  tripStatus,
  validateTripDraft,
} from './trips';
describe('trip dates, filters and shared aggregates', () => {
  it.each([
    ['2026-09-04', 'Upcoming'],
    ['2026-09-05', 'In progress'],
    ['2026-09-13', 'In progress'],
    ['2026-09-14', 'Past'],
  ])('uses injected clock %s', (today, status) =>
    expect(tripStatus({ start: '2026-09-05', end: '2026-09-13' }, today)).toBe(
      status,
    ),
  );
  it('matches approved samples and excludes deleted expense and repayments', () => {
    const data = fixture('sample', '2026-09-20');
    expect(
      tripCards(data, 'all').map((row) => [
        row.trip.id,
        row.total,
        row.count,
        row.status,
      ]),
    ).toEqual([
      ['maui', 164420, 7, 'Past'],
      ['tahoe', 84000, 3, 'Past'],
      ['porto', 0, 0, 'Upcoming'],
    ]);
    const expense = data.expenses.find((row) => row.tripId === 'maui')!;
    expect(
      tripCards(
        {
          ...data,
          expenses: data.expenses.map((row) =>
            row.id === expense.id ? { ...row, deleted: true } : row,
          ),
        },
        'all',
      )[0].total,
    ).toBe(164420 - expense.amount);
  });
  it('includes in-progress only in All and distinguishes future years', () => {
    const data = fixture('sample', '2026-09-05');
    expect(tripCards(data, 'upcoming').map((row) => row.trip.id)).toEqual([
      'porto',
    ]);
    expect(tripCards(data, 'past').map((row) => row.trip.id)).toEqual([
      'tahoe',
    ]);
    expect(tripDateLabel('2027-05-12')).toBe('May 12, 2027');
    expect(tripCards({ ...data, trips: [] }, 'all')).toEqual([]);
  });
  it('validates required name, real dates, end order, and same-day trips', () => {
    expect(
      validateTripDraft({
        name: ' ',
        destination: '',
        start: '2026-02-30',
        end: '2026-01-01',
      }).fields,
    ).toHaveProperty('name');
    expect(
      validateTripDraft({
        name: 'Trip',
        destination: '',
        start: '2026-02-30',
        end: '2026-01-01',
      }).fields,
    ).toHaveProperty('start');
    expect(
      validateTripDraft({
        name: 'Trip',
        destination: '',
        start: '2026-10-01',
        end: '2026-09-30',
      }).fields,
    ).toHaveProperty('end');
    expect(
      validateTripDraft({
        name: ' Day trip ',
        destination: '',
        start: '2026-10-01',
        end: '2026-10-01',
      }).value?.name,
    ).toBe('Day trip');
  });
});
