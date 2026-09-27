import type { Snapshot, Trip } from './data/port';
import { spending, validDate } from './ledger';
export type TripStatus = 'Upcoming' | 'In progress' | 'Past';
export type TripFilter = 'all' | 'upcoming' | 'past';
export type TripDraft = {
  name: string;
  destination: string;
  start: string;
  end: string;
};
export function tripStatus(
  trip: Pick<Trip, 'start' | 'end'>,
  today: string,
): TripStatus {
  if (
    !validDate(today) ||
    !validDate(trip.start) ||
    !validDate(trip.end) ||
    trip.end < trip.start
  )
    throw new Error('Valid trip dates and clock are required');
  return today < trip.start
    ? 'Upcoming'
    : today > trip.end
      ? 'Past'
      : 'In progress';
}
export function tripCards(snapshot: Snapshot, filter: TripFilter) {
  return snapshot.trips
    .map((trip) => ({
      trip,
      status: tripStatus(trip, snapshot.today),
      ...spending(snapshot.expenses, {
        currency: snapshot.household.currency,
        tripId: trip.id,
      }),
    }))
    .filter((row) => filter === 'all' || row.status.toLowerCase() === filter);
}
export function validateTripDraft(value: TripDraft) {
  const fields: Record<string, string> = {};
  if (!value.name.trim() || value.name.trim().length > 120)
    fields.name = 'Enter a trip name of 1–120 characters.';
  if (value.destination.length > 200)
    fields.destination = 'Use at most 200 characters.';
  if (!validDate(value.start)) fields.start = 'Enter a valid start date.';
  if (!validDate(value.end) || value.end < value.start)
    fields.end = 'End date must be on or after the start.';
  return {
    fields,
    value: Object.keys(fields).length
      ? undefined
      : { ...value, name: value.name.trim() },
  };
}
export function tripDateLabel(date: string): string {
  if (!validDate(date)) return 'Unavailable date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
