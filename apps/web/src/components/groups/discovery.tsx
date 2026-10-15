'use client';
import Link from 'next/link';
import { useEffect, useEffectEvent, useState } from 'react';
import { useFragment } from 'react-relay';
import { calendarDate } from '@/lib/dates';
import { financialReadMessage as message } from '@/lib/relay/read-error';
import { NetworkQuery } from '@/lib/relay/query';
import type { FinancialScope } from '@/lib/relay/environment';
import document, {
  type journeyViewerQuery,
} from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
import card, {
  type discoveryCard$key,
} from '@/lib/relay/__generated__/discoveryCard.graphql';
import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { Skeleton } from '../ui/primitives';
import uiStyles from '../ui/primitives.module.css';
import { cx } from '../ui/classnames';
import { tripState } from '@/lib/relay/discovery';
import { spaceHref } from '@/lib/relay/space-routes';
import { CreationForm } from './creation-form';
import { ScopedLink, RestoreSource } from './navigation';
import { useForegroundRefresh } from './foreground';
type Viewer = Extract<
  journeyViewerQuery['response']['viewer'],
  { readonly __typename: 'Viewer' }
>;
type Props = {
  scope: FinancialScope;
  trips: boolean;
  filter: string;
  creation?: 'ORDINARY' | 'TRIP';
};
const unavailable =
  'Financial data is unavailable. No zero balance or settled status can be established. Refresh to try again.';
export function ViewerJourney(props: Props) {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const [domainError, setDomainError] = useState('');
  const [state, setState] = useState({ busy: true, error: false });
  const refresh = () => {
    setVersion((v) => v + 1);
    setActive(true);
    setDomainError('');
    setState({ busy: true, error: false });
  };
  const invalidate = () => {
    setActive(false);
    setDomainError('');
    setState({ busy: true, error: false });
  };
  useForegroundRefresh(invalidate, refresh);
  useEffect(() => {
    const timer = setTimeout(refresh, 86400000 - (Date.now() % 86400000));
    return () => clearTimeout(timer);
  }, [version]);
  const loading = (
    <Skeleton label={props.trips ? 'Loading trips' : 'Loading groups'} />
  );
  return (
    <WorkspaceLoading busy={state.busy}>
      <WorkspaceRefresh
        busy={state.busy}
        error={domainError || (state.error ? unavailable : '')}
        onRefresh={refresh}
      />
      {active ? (
        <NetworkQuery<journeyViewerQuery>
          scope={props.scope}
          key={version}
          document={document}
          variables={{}}
          fallback={loading}
          failure={<p role="alert">{domainError || unavailable}</p>}
          onError={(error) => setDomainError(message(error.message))}
          onState={setState}
        >
          {(result) =>
            result.viewer.__typename === 'Viewer' ? (
              <DiscoveryResults
                {...props}
                viewer={result.viewer}
                onDenied={() => {
                  setActive(false);
                  setState({ busy: false, error: true });
                }}
              />
            ) : (
              <DiscoveryFailure
                result={result.viewer}
                onError={setDomainError}
              />
            )
          }
        </NetworkQuery>
      ) : state.error ? (
        <p role="alert">
          This account cannot access the requested financial data.
        </p>
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function DiscoveryResults({
  scope,
  trips,
  filter,
  creation,
  viewer,
  onDenied,
}: Props & { viewer: Viewer; onDenied: () => void }) {
  const groups = viewer.groups.filter(
    (item) =>
      !item.isHousehold &&
      (trips
        ? item.kind === 'TRIP' &&
          !!item.trip &&
          (filter === 'all' ||
            tripState(item.trip, viewer.today).toLowerCase() === filter)
        : item.kind === 'ORDINARY'),
  );

  return (
    <>
      <p className="journey-viewer">Signed in as {viewer.displayName}</p>
      {creation &&
        (viewer.canCreateGroups ? (
          <CreationForm
            scope={scope}
            actor={viewer.id}
            today={viewer.today}
            kind={creation}
            onDenied={() => {
              onDenied();
            }}
          />
        ) : (
          <p role="alert">
            This account cannot create groups. Return to Groups or refresh your
            access.
          </p>
        ))}
      {!creation && (
        <>
          {viewer.canCreateGroups && (
            <Link
              data-ui="button button--primary"
              className={cx(
                uiStyles.button,
                uiStyles['button--primary'],
                'discovery-create',
              )}
              href={trips ? '/trips/new' : '/groups/new'}
            >
              {trips ? 'Create trip' : 'Create group'}
            </Link>
          )}
          {trips && (
            <nav className="discovery-filters" aria-label="Trip date filter">
              {['all', 'upcoming', 'past'].map((value) => (
                <Link
                  key={value}
                  aria-current={filter === value ? 'page' : undefined}
                  href={`/trips?filter=${value}`}
                >
                  {value === 'all'
                    ? 'All'
                    : value === 'upcoming'
                      ? 'Upcoming'
                      : 'Past'}
                </Link>
              ))}
            </nav>
          )}
          {!groups.length ? (
            <p>
              {trips
                ? viewer.groups.length
                  ? 'No trips match this filter.'
                  : 'You have no admitted trips or groups.'
                : viewer.groups.length > 0
                  ? 'No ordinary groups yet. Household and Trips are available in the main navigation.'
                  : 'You have no admitted groups.'}{' '}
              {viewer.canCreateGroups
                ? 'Create a group to begin.'
                : 'Open your invitation and explicitly join to continue.'}
            </p>
          ) : (
            <ul className="discovery-cards">
              {groups.map((item) => (
                <DiscoveryCard
                  key={item.id}
                  scope={scope}
                  reference={item}
                  today={viewer.today}
                />
              ))}
            </ul>
          )}
          <RestoreSource
            scope={scope}
            allowed={groups.map((item) => item.id)}
          />
        </>
      )}
    </>
  );
}

function DiscoveryCard({
  scope,
  reference,
  today,
}: {
  scope: FinancialScope;
  reference: discoveryCard$key;
  today: string;
}) {
  const item = useFragment(card, reference);
  return (
    <li>
      <div
        className={`financial-cover ${item.trip ? 'financial-cover--trip' : ''}`}
        aria-hidden="true"
      />
      <ScopedLink scope={scope} id={`group-${item.id}`} href={spaceHref(item)}>
        {item.name} · {item.kind === 'TRIP' ? 'Trip' : 'Group'}
      </ScopedLink>
      {item.trip && (
        <p>
          {item.trip.destination} ·{' '}
          <time dateTime={item.trip.startDate}>
            {calendarDate(item.trip.startDate)}
          </time>{' '}
          –{' '}
          <time dateTime={item.trip.endDate}>
            {calendarDate(item.trip.endDate)}
          </time>{' '}
          · {tripState(item.trip, today)}
        </p>
      )}
    </li>
  );
}

function DiscoveryFailure({
  result,
  onError,
}: {
  result: journeyViewerQuery['response']['viewer'];
  onError: (error: string) => void;
}) {
  const error = message(
    'state' in result
      ? result.state
      : 'code' in result
        ? result.code
        : 'UNAVAILABLE',
  );
  const report = useEffectEvent(onError);
  useEffect(() => {
    report(error);
  }, [error]);
  return <p role="alert">{error}</p>;
}
