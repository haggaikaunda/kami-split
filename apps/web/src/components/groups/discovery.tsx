'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Button } from '../ui/primitives';
import { AppIcon } from '@/components/workspace-identity';
import { minor, money } from '@/lib/relay/money';

import { tripState } from '@/lib/relay/discovery';
import { spaceHref } from '@/lib/relay/space-routes';
import { CreationForm } from './creation-form';
import { CreationPresentation } from './creation-presentation';
import creationStyles from './creation.module.css';
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
  filter: requestedFilter,
  selection: requestedSelection,
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
  const router = useRouter();
  const source = params.get('source');
  const visit = source ? scope.visits.get(source) : undefined;
  const sourceUrl = visit
    ? new URL(visit.href, 'https://workspace.invalid')
    : undefined;
  const selection =
    creation && sourceUrl
      ? ['groups', 'trips'].includes(sourceUrl.searchParams.get('kind') ?? '')
        ? sourceUrl.searchParams.get('kind')!
        : 'all'
      : creation
        ? 'all'
        : requestedSelection;
  const filter =
    creation && sourceUrl
      ? (sourceUrl.searchParams.get('filter') ?? 'all')
      : requestedFilter;
  if (sourceUrl && source) sourceUrl.searchParams.set('restore', source);
  const returnHref = sourceUrl
    ? sourceUrl.pathname + sourceUrl.search
    : '/groups';
  const closeCreation = () => {
    if (source) scope.restored.delete(source);
    router.push(returnHref, { scroll: false });
  };
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
      {creation &&
        (viewer.canCreateGroups ? (
          <CreationPresentation onClose={closeCreation}>
            <CreationForm
              source={source ?? undefined}
              returnHref={returnHref}
              scope={scope}
              actor={viewer.id}
              today={viewer.today}
              kind={creation}
              onDenied={() => {
                onDenied();
              }}
            />
          </CreationPresentation>
        ) : (
          <p role="alert">
            This account cannot create groups. Return to Groups or refresh your
            access.
          </p>
        ))}
      <>
        <div
          data-ui="directory-toolbar"
          className={discoveryFeatureStyles['directory-toolbar']}
        >
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
            <Button
              tone="secondary"
              id="directory-create"
              onClick={() => setCreating(true)}
            >
              <AppIcon name="plus" /> Create
            </Button>
          )}
        </div>
        {!creation && creating && (
          <CreationPresentation onClose={() => setCreating(false)}>
            <h2 id="creation-heading" tabIndex={-1}>
              Create a shared space
            </h2>
            <div className={creationStyles.choices}>
              {(
                [
                  [
                    'ORDINARY',
                    'Group',
                    'Ongoing shared expenses',
                    '/groups/new',
                    'groups',
                  ],
                  [
                    'TRIP',
                    'Trip',
                    'Expenses for a journey together',
                    '/trips/new',
                    'trip',
                  ],
                ] as const
              ).map(([type, label, description, href, icon]) => (
                <ScopedLink
                  key={type}
                  scope={scope}
                  id={type === 'TRIP' ? 'create-trip' : 'create-group'}
                  sourceFocus="directory-create"
                  href={href}
                  aria-label={`Create ${label.toLowerCase()}`}
                  className={creationStyles.choice}
                >
                  <span className={creationStyles.icon}>
                    <AppIcon name={icon} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </ScopedLink>
              ))}
            </div>
          </CreationPresentation>
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
          <span className={discoveryFeatureStyles['card-title']}>
            <strong>{item.name}</strong>
            <span className={discoveryFeatureStyles['card-meta']}>
              {item.kind === 'TRIP' ? 'Trip' : 'Group'} ·{' '}
              {entry.activeMemberCount} active{' '}
              {entry.activeMemberCount === 1 ? 'member' : 'members'}
              {item.trip && (
                <>
                  {' · '}
                  {item.trip.destination && <>{item.trip.destination} · </>}
                  <time dateTime={item.trip.startDate}>
                    {calendarDate(item.trip.startDate)}
                  </time>
                  {' – '}
                  <time dateTime={item.trip.endDate}>
                    {calendarDate(item.trip.endDate)}
                  </time>
                  {' · '}
                  {tripState(item.trip, today)}
                </>
              )}
            </span>
          </span>
          <svg
            aria-hidden="true"
            className={discoveryFeatureStyles['card-chevron']}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <span
          data-ui="directory-finances"
          className={discoveryFeatureStyles['card-finances']}
        >
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
              {net === null
                ? 'Unavailable'
                : net > 0n
                  ? `You’re owed ${money(net.toString())}`
                  : net < 0n
                    ? `You owe ${money(net.toString()).replace(/^-/, '')}`
                    : 'Nothing for you to pay or collect'}
            </strong>
            {net === null && <span>Refresh to try again</span>}
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
