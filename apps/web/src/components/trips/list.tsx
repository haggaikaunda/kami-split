'use client';
import Link from 'next/link';
import { useAppData } from '../data-provider';
import {
  useExpenseNavigation,
  useRouteContext,
  useRouteReady,
} from '../navigation/provider';
import { DraftLink } from '../navigation/links';
import { Button, EmptyState, Skeleton, Status } from '../primitives';
import { tripCards, tripDateLabel, type TripFilter } from '@/lib/trips';
import { formatMoney } from '@/lib/ledger';
import { TripCover, TripCredits } from './cover';
import './trips.css';
export function TripsList() {
  const { snapshot, status, refresh, readyVersion } = useAppData();
  const { searchParams } = useRouteContext('/trips');
  const { openContext } = useExpenseNavigation();
  useRouteReady('/trips', readyVersion);
  const raw = searchParams.get('filter');
  const filter: TripFilter = raw === 'upcoming' || raw === 'past' ? raw : 'all';
  const rows = snapshot ? tripCards(snapshot, filter) : [];
  return (
    <div className="trips-screen">
      <header className="trips-heading">
        <div>
          <p className="ui-eyebrow">Shared adventures</p>
          <h1 data-page-heading tabIndex={-1}>
            Trips
          </h1>
          <p>Keep the spending, share the memories.</p>
        </div>
        <div className="trips-actions">
          <DraftLink draftId="new-trip" id="trips-create">
            Create trip
          </DraftLink>
        </div>
      </header>
      <nav className="trips-filters" aria-label="Trip status">
        {(['all', 'upcoming', 'past'] as const).map((item) => (
          <Link
            key={item}
            href={item === 'all' ? '/trips' : `/trips?filter=${item}`}
            aria-current={filter === item ? 'page' : undefined}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </Link>
        ))}
      </nav>
      {status === 'loading' ? (
        <Skeleton label="Loading trips" />
      ) : !snapshot ? (
        <Status kind="denied">
          Trips are unavailable to this session.
          <Button onClick={() => void refresh()}>Try again</Button>
        </Status>
      ) : (
        <>
          {status !== 'ready' && (
            <Status kind="stale">
              Showing previously confirmed trips. Current data is refreshing or
              unavailable.
              <Button onClick={() => void refresh()}>Refresh trips</Button>
            </Status>
          )}
          {rows.length ? (
            <div className="trips-grid">
              {rows.map(({ trip, status: tripState, total, count }) => (
                <article className="ui-card" key={trip.id}>
                  <Link
                    className="trips-card"
                    id={`trip-card-${trip.id}`}
                    onClick={(event) => {
                      if (
                        event.button === 0 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey
                      ) {
                        event.preventDefault();
                        openContext(
                          `/trips/${encodeURIComponent(trip.id)}`,
                          `trip-card-${trip.id}`,
                        );
                      }
                    }}
                    href={`/trips/${encodeURIComponent(trip.id)}`}
                    aria-label={`View ${trip.name}, ${tripDateLabel(trip.start)} to ${tripDateLabel(trip.end)}`}
                  >
                    <div className="trips-cover-wrap">
                      <TripCover cover={trip.cover} />
                      <span className="trips-status">{tripState}</span>
                    </div>
                    <div className="trips-card-body">
                      <h2>{trip.name}</h2>
                      <p>
                        {tripDateLabel(trip.start)} – {tripDateLabel(trip.end)}
                      </p>
                      {trip.destination && <p>{trip.destination}</p>}
                      <div className="trips-card-total">
                        <div>
                          <span>Total spent</span>
                          <strong className="ui-money">
                            {formatMoney(total, snapshot.household.currency)}
                          </strong>
                        </div>
                        <span>
                          {count} {count === 1 ? 'expense' : 'expenses'} →
                        </span>
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              headingLevel={2}
              title={
                snapshot.trips.length
                  ? 'No trips match this filter'
                  : 'Your next adventure starts here'
              }
            >
              {snapshot.trips.length ? (
                <Link className="shell-action" href="/trips">
                  Show all trips
                </Link>
              ) : (
                <>Create a trip to organize its shared expenses.</>
              )}
            </EmptyState>
          )}
          <TripCredits />
        </>
      )}
    </div>
  );
}
