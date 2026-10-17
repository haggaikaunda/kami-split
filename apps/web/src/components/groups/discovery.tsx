'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { ContentLoading } from '../ui/loading';
import { Button, Dialog } from '../ui/primitives';
import { AppIcon } from '@/components/workspace-identity';
import { minor, money } from '@/lib/relay/money';

import { tripState } from '@/lib/relay/discovery';
import { spaceHref } from '@/lib/relay/space-routes';
import { CreationForm } from './creation-form';
import { ScopedLink, RestoreSource } from './navigation';
import { useForegroundRefresh } from './foreground';

import discoveryFeatureStyles from './discovery.module.css';

type Viewer = Extract<
  journeyViewerQuery['response']['viewer'],
  { readonly __typename: 'Viewer' }
>;
type Props = {
  scope: FinancialScope;
  trips: boolean;
  filter: string;
  selection: string;
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
    <ContentLoading layout="cards" label={props.trips ? 'trips' : 'groups'} />
  );
  return (
    <WorkspaceLoading busy={state.busy}>
      <WorkspaceRefresh
        contentPending
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
                directory={result.groupDirectory}
                onError={setDomainError}
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
  filter,
  selection,
  creation,
  viewer,
  directory,
  onError,
  onDenied,
}: Props & {
  viewer: Viewer;
  directory: journeyViewerQuery['response']['groupDirectory'];
  onError: (error: string) => void;
  onDenied: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const params = useSearchParams();
  const source = params.get('source');
  const visit = source ? scope.visits.get(source) : undefined;
  const entries =
    directory.__typename === 'GroupDirectory' ? directory.entries : [];
  const groups = entries.filter(
    ({ group: item }) =>
      !item.isHousehold &&
      (selection === 'trips'
        ? item.kind === 'TRIP' &&
          !!item.trip &&
          (filter === 'all' ||
            tripState(item.trip, viewer.today).toLowerCase() === filter)
        : selection === 'groups'
          ? item.kind === 'ORDINARY'
          : true),
  );

  return (
    <>
      <p
        data-ui="journey-viewer"
        className={discoveryFeatureStyles['journey-viewer']}
      >
        Signed in as {viewer.displayName}
      </p>
      {creation &&
        (viewer.canCreateGroups ? (
          <CreationForm
            source={source ?? undefined}
            returnHref={
              visit
                ? `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${source}`
                : undefined
            }
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
          <div className={discoveryFeatureStyles['directory-toolbar']}>
            <nav
              className={discoveryFeatureStyles['discovery-filters']}
              aria-label="Group type"
            >
              {['all', 'groups', 'trips'].map((value) => (
                <Link
                  key={value}
                  href={value === 'all' ? '/groups' : `/groups?kind=${value}`}
                  aria-current={selection === value ? 'page' : undefined}
                >
                  {value === 'all'
                    ? 'All'
                    : value === 'groups'
                      ? 'Groups'
                      : 'Trips'}
                </Link>
              ))}
            </nav>
            {viewer.canCreateGroups && (
              <Button id="directory-create" onClick={() => setCreating(true)}>
                Create
              </Button>
            )}
          </div>
          {creating && (
            <Dialog
              open
              title="Create a shared space"
              onClose={() => setCreating(false)}
            >
              <p>
                <ScopedLink
                  scope={scope}
                  id="create-group"
                  sourceFocus="directory-create"
                  href="/groups/new"
                >
                  Create group
                </ScopedLink>
              </p>
              <p>
                <ScopedLink
                  scope={scope}
                  id="create-trip"
                  sourceFocus="directory-create"
                  href="/trips/new"
                >
                  Create trip
                </ScopedLink>
              </p>
            </Dialog>
          )}
          {selection === 'trips' && (
            <nav
              data-ui="discovery-filters"
              className={discoveryFeatureStyles['discovery-filters']}
              aria-label="Trip date filter"
            >
              {['all', 'upcoming', 'past'].map((value) => (
                <Link
                  key={value}
                  aria-current={filter === value ? 'page' : undefined}
                  href={`/groups?kind=trips&filter=${value}`}
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
          {directory.__typename !== 'GroupDirectory' && !creation ? (
            <DiscoveryFailure result={directory} onError={onError} />
          ) : !groups.length ? (
            <p>
              {entries.filter((item) => !item.group.isHousehold).length
                ? selection === 'trips'
                  ? 'No trips match this filter.'
                  : 'No groups match this filter.'
                : 'You have no admitted groups or trips.'}{' '}
              {viewer.canCreateGroups
                ? 'Create a group or trip to begin.'
                : 'Open your invitation and explicitly join to continue.'}
            </p>
          ) : (
            <ul
              data-ui="discovery-cards"
              className={discoveryFeatureStyles['discovery-cards']}
            >
              {groups.map((item) => (
                <DiscoveryCard
                  key={item.group.id}
                  scope={scope}
                  reference={item}
                  today={viewer.today}
                />
              ))}
            </ul>
          )}
          {directory.__typename === 'GroupDirectory' && (
            <RestoreSource
              scope={scope}
              allowed={groups.map((item) => item.group.id)}
            />
          )}
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
  const entry = useFragment(card, reference);
  const item = entry.group;
  const summary = entry.financialSummary;
  const net =
    summary.__typename === 'GroupFinancialSummary'
      ? minor(summary.viewerNetMinor)
      : null;
  return (
    <li>
      <ScopedLink scope={scope} id={`group-${item.id}`} href={spaceHref(item)}>
        <span className={discoveryFeatureStyles['card-heading']}>
          <span
            aria-hidden="true"
            className={discoveryFeatureStyles['card-icon']}
          >
            <AppIcon name={item.kind === 'TRIP' ? 'trip' : 'groups'} />
          </span>
          <strong>{item.name}</strong>
          <span>
            {item.kind === 'TRIP' ? 'Trip' : 'Group'} ·{' '}
            {entry.activeMemberCount} active{' '}
            {entry.activeMemberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
        {item.trip && (
          <span className={discoveryFeatureStyles['card-meta']}>
            {item.trip.destination} ·{' '}
            <time dateTime={item.trip.startDate}>
              {calendarDate(item.trip.startDate)}
            </time>{' '}
            –{' '}
            <time dateTime={item.trip.endDate}>
              {calendarDate(item.trip.endDate)}
            </time>{' '}
            · {tripState(item.trip, today)}
          </span>
        )}
        <span className={discoveryFeatureStyles['card-finances']}>
          <span>
            <span>Total spend · {item.currency}</span>
            <strong>
              {summary.__typename === 'GroupFinancialSummary'
                ? money(summary.totalSpendMinor)
                : 'Unavailable'}
            </strong>
          </span>
          <span
            data-position={
              net === null
                ? undefined
                : net > 0n
                  ? 'positive'
                  : net < 0n
                    ? 'negative'
                    : 'zero'
            }
          >
            <span>Your balance · {item.currency}</span>
            <strong>
              {summary.__typename === 'GroupFinancialSummary'
                ? money(summary.viewerNetMinor)
                : 'Unavailable'}
            </strong>
            <span>
              {net === null
                ? 'Refresh to try again'
                : net > 0n
                  ? 'You’re owed'
                  : net < 0n
                    ? 'You owe'
                    : 'Nothing for you to pay or collect'}
            </span>
          </span>
        </span>
      </ScopedLink>
    </li>
  );
}

function DiscoveryFailure({
  result,
  onError,
}: {
  result:
    | journeyViewerQuery['response']['viewer']
    | journeyViewerQuery['response']['groupDirectory'];
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
