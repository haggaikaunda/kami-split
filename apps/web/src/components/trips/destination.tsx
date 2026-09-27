'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useAppData } from '../data-provider';
import {
  useExpenseNavigation,
  useRouteContext,
  useRouteReady,
} from '../navigation/provider';
import { DraftLink } from '../navigation/links';
import { Button, EmptyState, Skeleton, Status } from '../primitives';
import { tripDetail } from '@/lib/trip-detail';
import { tripDateLabel, tripStatus } from '@/lib/trips';
import { TripCover, TripCredits } from './cover';
import { TripOverview } from './overview';
import { TripExpenses } from './expenses';
import './trips.css';
import './detail.css';
export function TripDestination({ tripId }: { tripId: string }) {
  const { snapshot, status, refresh, readyVersion } = useAppData();
  const route = `/trips/${encodeURIComponent(tripId)}`;
  useRouteReady(route, readyVersion);
  const { searchParams, isActive } = useRouteContext(route);
  const visit = searchParams.get('visit');
  const tab = searchParams.get('tab') === 'expenses' ? 'expenses' : 'overview';
  const focusExpenses = useRef(false);
  useEffect(() => {
    if (tab === 'expenses' && isActive && focusExpenses.current) {
      document.getElementById('trip-expenses-heading')?.focus();
      focusExpenses.current = false;
    }
  }, [tab, isActive]);
  const { getSource, returnToSource, replaceQuery } = useExpenseNavigation();
  const back = getSource(visit) ? (
    <Button tone="secondary" onClick={() => returnToSource(visit)}>
      Back to previous view
    </Button>
  ) : (
    <Link className="shell-action" href="/trips">
      All trips
    </Link>
  );
  const readable =
    snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  const model = readable ? tripDetail(snapshot, tripId) : undefined;
  if (status === 'loading')
    return (
      <>
        <h1 data-page-heading tabIndex={-1}>
          Loading trip
        </h1>
        <Skeleton label="Loading trip" />
      </>
    );
  if (!model || !snapshot)
    return (
      <>
        <h1 data-page-heading tabIndex={-1}>
          Trip unavailable
        </h1>
        <Status kind="denied">
          This trip is unavailable to the current session. No financial details
          are shown.<Button onClick={() => void refresh()}>Try again</Button>
        </Status>
        {back}
      </>
    );
  const { trip } = model;
  const filters = {
    search: searchParams.get('search') ?? '',
    category: searchParams.get('category') ?? 'all',
  };
  function change(values: Record<string, string>) {
    if (!isActive) return;
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === 'all' || (key === 'tab' && value === 'overview'))
        next.delete(key);
      else next.set(key, value);
    }
    replaceQuery(`${route}${next.size ? `?${next}` : ''}`);
  }
  return (
    <div className="trips-screen trip-detail">
      {back}
      <header className="trip-detail-hero">
        <TripCover key={trip.cover} cover={trip.cover} />
        <div className="trip-detail-hero-copy">
          <p className="trip-detail-status">
            {tripStatus(trip, snapshot.today)}
          </p>
          <h1 data-page-heading tabIndex={-1}>
            {trip.name}
          </h1>
          <p>
            {trip.destination && <>{trip.destination} · </>}
            {tripDateLabel(trip.start)} – {tripDateLabel(trip.end)}
          </p>
        </div>
      </header>
      <div className="trip-detail-toolbar">
        <div className="trip-detail-tabs" role="group" aria-label="Trip views">
          {(['overview', 'expenses'] as const).map((view) => (
            <Button
              key={view}
              tone={tab === view ? 'primary' : 'secondary'}
              aria-pressed={tab === view}
              disabled={!isActive}
              onClick={() => change({ tab: view })}
            >
              {view === 'overview' ? 'Overview' : 'Expenses'}
            </Button>
          ))}
        </div>
        <div className="trips-actions">
          <DraftLink draftId="new-expense" id={`trip-${trip.id}-add-expense`}>
            Add expense
          </DraftLink>
        </div>
      </div>
      {status !== 'ready' && (
        <Status kind="stale">
          Showing the last confirmed trip while current data is refreshing or
          unavailable.
          <Button tone="secondary" onClick={() => void refresh()}>
            Refresh trip
          </Button>
        </Status>
      )}
      {tab === 'overview' ? (
        <>
          <TripOverview
            snapshot={snapshot}
            model={model}
            showExpenses={() => {
              focusExpenses.current = true;
              change({ tab: 'expenses' });
            }}
          />
          {model.count === 0 && (
            <EmptyState headingLevel={2} title="No expenses yet">
              Add the first shared expense for {trip.name}. Dates before the
              trip are allowed.
            </EmptyState>
          )}
        </>
      ) : (
        <TripExpenses
          snapshot={snapshot}
          expenses={model.expenses}
          filters={filters}
          active={isActive}
          change={change}
        />
      )}
      <section
        className="trip-household-repayment"
        aria-label="Household repayment"
      >
        <p>
          These expenses are included once in your household balance. A
          repayment affects the household balance; it does not change this
          trip’s spending or allocated shares.
        </p>
        <div className="trips-actions">
          <DraftLink draftId="new-repayment" id={`trip-${trip.id}-repayment`}>
            Record a household repayment
          </DraftLink>
        </div>
      </section>
      <TripCredits />
    </div>
  );
}
