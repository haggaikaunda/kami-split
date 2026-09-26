'use client';
import Link from 'next/link';
import { useAppData } from '../data-provider';
import { useRouteReady } from '../navigation/provider';
import { DraftLink } from '../navigation/links';
import { Button, Card, EmptyState, Skeleton, Status } from '../primitives';
import { formatMoney, spending } from '@/lib/ledger';
import { tripDateLabel, tripStatus } from '@/lib/trips';
import { TripCover } from './cover';
import './trips.css';
export function TripDestination({ tripId }: { tripId: string }) {
  const { snapshot, status, refresh, readyVersion } = useAppData();
  useRouteReady(`/trips/${encodeURIComponent(tripId)}`, readyVersion);
  const trip = snapshot?.trips.find((row) => row.id === tripId);
  if (status === 'loading') return <Skeleton label="Loading trip" />;
  if (!trip || !snapshot)
    return (
      <>
        <h1 data-page-heading tabIndex={-1}>
          Trip unavailable
        </h1>
        <Status kind="denied">
          This trip is unavailable to the current session.
          <Button onClick={() => void refresh()}>Try again</Button>
        </Status>
        <Link href="/trips">All trips</Link>
      </>
    );
  const total = spending(snapshot.expenses, {
    currency: snapshot.household.currency,
    tripId,
  });
  return (
    <div className="trips-screen">
      <Link href="/trips">All trips</Link>
      <TripCover cover={trip.cover} />
      <header className="trips-heading">
        <div>
          <p>{tripStatus(trip, snapshot.today)}</p>
          <h1 data-page-heading tabIndex={-1}>
            {trip.name}
          </h1>
          <p>
            {tripDateLabel(trip.start)} – {tripDateLabel(trip.end)}
          </p>
          {trip.destination && <p>{trip.destination}</p>}
        </div>
        <div className="trips-actions">
          <DraftLink draftId="new-expense" id={`trip-${trip.id}-add-expense`}>
            Add expense
          </DraftLink>
        </div>
      </header>
      {status !== 'ready' && (
        <Status kind="stale">
          Showing the last confirmed trip while current data is unavailable.
        </Status>
      )}
      <Card title="Total spent">
        <p className="ui-money">
          {formatMoney(total.total, snapshot.household.currency)}
        </p>
        <p>
          {total.count} {total.count === 1 ? 'expense' : 'expenses'}
        </p>
      </Card>
      {total.count === 0 && (
        <EmptyState title="No expenses yet">
          Add the first shared expense for {trip.name}.
        </EmptyState>
      )}
    </div>
  );
}
