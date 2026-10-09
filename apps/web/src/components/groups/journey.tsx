'use client';
import { WorkspaceNavigation } from '@/components/workspace-identity';
import Link from 'next/link';
import { expenseFilterText } from '@/lib/relay/expense-filter';
import {
  WorkspaceTabs,
  workspaceSections,
  Skeleton,
} from '@/components/primitives';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchQuery, readInlineData } from 'relay-runtime';
import expenseView, {
  type expensesView$key,
} from '@/lib/relay/__generated__/expensesView.graphql';
import activityFeed, {
  type activityFeed$key,
} from '@/lib/relay/__generated__/activityFeed.graphql';
import viewerDocument, {
  type journeyViewerQuery,
} from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
import groupDocument, {
  type journeyWorkspaceQuery,
} from '@/lib/relay/__generated__/journeyWorkspaceQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { ScopedLink, RestoreSource, SourceReturn } from './navigation';
import {
  householdLedgerHref,
  spaceHref,
  spaceInvitationsHref,
} from '@/lib/relay/space-routes';
import { tripState, routeId } from '@/lib/relay/discovery';
import { ExpensePresentation } from '@/components/expenses/presentation';
import { ExpenseDetail } from './expense-detail';
import { GroupWorkspace } from './workspace';
import { useFinancialSession } from './session';
import { CreationForm } from './creation-form';
import './journey.css';
import { createWorkspaceIntent } from '@/lib/relay/intent';
import { workspaceRequest } from '@/lib/relay/workspace-request';
import { useForegroundRefresh } from './foreground';
type Viewer = Extract<
  journeyViewerQuery['response']['viewer'],
  { readonly __typename: 'Viewer' }
>;
type Group = Extract<
  journeyWorkspaceQuery['response']['group'],
  { readonly __typename: 'Group' }
>;
function message(code: string) {
  if (['NOT_FOUND', 'DISABLED', 'UNPROVISIONED'].includes(code))
    return 'This account cannot access the requested financial data.';
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_CHANGED')
    return 'Your session is unavailable. Sign in again before continuing.';
  if (code === 'INVALID_CURSOR')
    return 'This expense page is no longer available. Restart the list.';
  return 'Financial data is unavailable. No zero balance or settled status can be established. Refresh to try again.';
}
export function GroupJourney({
  initialGroup: pathGroup = '',
  expense: pathExpense = '',
  repayment = false,
  trips = false,
  filter = 'all',
  creation,
  household = false,
}: {
  household?: boolean;
  creation?: 'ORDINARY' | 'TRIP';
  initialGroup?: string;
  expense?: string;
  repayment?: boolean;
  trips?: boolean;
  filter?: string;
}) {
  const initialGroup = routeId(pathGroup),
    expense = routeId(pathExpense);
  const access = useFinancialSession();
  const intent = useMemo(
    () => (access.scope ? createWorkspaceIntent(access.scope) : undefined),
    [access.scope],
  );
  useEffect(() => () => intent?.cancel(), [intent]);
  const params = useSearchParams(),
    pathname = usePathname();
  const intentVisit = pathname + '?' + params.toString();
  useLayoutEffect(() => {
    intent?.cancel();
  }, [intent, intentVisit]);
  useEffect(() => {
    const cancel = () => intent?.cancel();
    window.addEventListener('focus', cancel);
    window.addEventListener('pageshow', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('focus', cancel);
      window.removeEventListener('pageshow', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [intent]);
  const groupBase = `${pathname.startsWith('/trips/') ? '/trips' : '/groups'}/${encodeURIComponent(initialGroup)}`;
  const currentTab =
    workspaceSections.find((t) => t.toLowerCase() === params.get('tab')) ??
    (params.has('after') ? 'Expenses' : 'Overview');
  const visitParams = new URLSearchParams(params);
  for (const key of [
    'tab',
    'expense',
    'expenseGroup',
    'detailSource',
    'view',
    'basis',
    'create',
    'groupId',
    'category',
    'memberId',
    'from',
    'to',
  ])
    visitParams.delete(key);
  const returnQuery = new URLSearchParams();
  for (const key of ['tab', 'sender', 'recipient', 'amount', 'kind']) {
    const value = params.get(key);
    if (value) returnQuery.set(key, value);
  }
  const signInReturn = pathname + (returnQuery.size ? `?${returnQuery}` : '');
  const body = access.loading ? (
    <p role="status">Loading secure access…</p>
  ) : access.error ? (
    <p role="alert">{access.error}</p>
  ) : !access.scope ? (
    <p>
      <Link href={`/sign-in?next=${encodeURIComponent(signInReturn)}`}>
        Sign in
      </Link>{' '}
      with your invited account to see your groups.
    </p>
  ) : initialGroup ? (
    <>
      <SourceReturn scope={access.scope} household={household} />
      <GroupDetails
        key={`${access.scope.id}:${initialGroup}:${expense}:${repayment}:${currentTab}:${visitParams}`}
        scope={access.scope}
        household={household}
        id={initialGroup}
        expense={expense}
        repayment={repayment}
      />
    </>
  ) : (
    <ViewerJourney
      key={`${access.scope.id}:${initialGroup}:${expense}:${repayment}:${trips}:${filter}:${pathname}:${visitParams.toString()}`}
      scope={access.scope}
      trips={trips}
      filter={filter}
      creation={creation}
    />
  );
  if (household) return body;
  return (
    <main
      className={`financial-journey ${initialGroup ? 'group-workspace' : ''}`}
      id="page-content"
    >
      <WorkspaceNavigation />
      <header className="journey-page-heading">
        {!initialGroup && (
          <h1 data-page-heading tabIndex={-1}>
            {creation
              ? creation === 'TRIP'
                ? 'New trip'
                : 'New group'
              : trips
                ? 'Your trips'
                : initialGroup
                  ? 'Your group'
                  : 'Your groups'}
          </h1>
        )}
      </header>
      {initialGroup && (
        <WorkspaceTabs
          current={repayment ? 'Balances' : currentTab}
          label={trips ? 'Trip workspace' : 'Group workspace'}
          onIntent={(section) =>
            intent?.warm(workspaceRequest(initialGroup, section.toLowerCase()))
          }
          onIntentEnd={(section) =>
            intent?.cancel(
              section
                ? workspaceRequest(initialGroup, section.toLowerCase()).key
                : undefined,
            )
          }
          hrefFor={(section) => `${groupBase}?tab=${section.toLowerCase()}`}
        />
      )}
      {body}
    </main>
  );
}
function ViewerJourney({
  scope,
  trips,
  filter,
  creation,
}: {
  scope: FinancialScope;
  trips: boolean;
  filter: string;
  creation?: 'ORDINARY' | 'TRIP';
}) {
  const [viewer, setViewer] = useState<Viewer>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const pathname = usePathname();
  const visit = pathname;
  useEffect(() => {
    const refresh = () => {
      setViewer(undefined);
      setError('');
      setStale(true);
      setVersion((v) => v + 1);
    };
    const foreground = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setTimeout(refresh, 86400000 - (Date.now() % 86400000));
    document.addEventListener('visibilitychange', foreground);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [version]);
  useEffect(() => {
    let active = true;
    const subscription = fetchQuery<journeyViewerQuery>(
      scope.environment,
      viewerDocument,
      {},
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next: (result) => {
        if (!active || !scope.isLive()) return;
        if (result.viewer.__typename === 'Viewer') setViewer(result.viewer);
        else
          setError(
            message(
              'state' in result.viewer
                ? result.viewer.state
                : 'code' in result.viewer
                  ? result.viewer.code
                  : 'UNAVAILABLE',
            ),
          );
      },
      error: (failure: Error) => {
        if (active && scope.isLive()) setError(message(failure.message));
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [scope, version, visit]);
  if (error)
    return (
      <>
        <p role="alert">{error}</p>
        <button
          onClick={() => {
            setError('');
            setViewer(undefined);
            setVersion((v) => v + 1);
          }}
        >
          Refresh access
        </button>
      </>
    );
  if (!viewer)
    return (
      <p role="status">
        {stale
          ? 'Access is stale. Refreshing current authorized groups…'
          : 'Loading your groups…'}
      </p>
    );
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
              setViewer(undefined);
              setError(message('NOT_FOUND'));
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
            <Link href={trips ? '/trips/new' : '/groups/new'}>
              {trips ? 'Create trip' : 'Create group'}
            </Link>
          )}
          {trips && (
            <nav aria-label="Trip date filter">
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
                <li key={item.id}>
                  <div
                    className={`financial-cover ${item.trip ? 'financial-cover--trip' : ''}`}
                    aria-hidden="true"
                  />
                  <ScopedLink
                    scope={scope}
                    id={`group-${item.id}`}
                    href={spaceHref(item)}
                  >
                    {item.name} · {item.kind === 'TRIP' ? 'Trip' : 'Group'}
                  </ScopedLink>
                  {item.trip && (
                    <p>
                      {item.trip.destination} ·{' '}
                      <time dateTime={item.trip.startDate}>
                        {item.trip.startDate}
                      </time>{' '}
                      –{' '}
                      <time dateTime={item.trip.endDate}>
                        {item.trip.endDate}
                      </time>{' '}
                      · {tripState(item.trip, viewer.today)}
                    </p>
                  )}
                </li>
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
function GroupDetails({
  scope,
  id,
  expense,
  repayment,
  household = false,
}: {
  household?: boolean;
  scope: FinancialScope;
  id: string;
  expense: string;
  repayment: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    pathname = usePathname();
  const after = params.get('after');
  const tab = (
    workspaceSections.find(
      (section) => section.toLowerCase() === params.get('tab'),
    ) ?? (after ? 'Expenses' : 'Overview')
  ).toLowerCase();
  const [today, setToday] = useState('');
  const [destination, setDestination] =
    useState<journeyWorkspaceQuery['response']>();
  const initialFilters = expenseFilterText(params);
  const [loadedFilters, setLoadedFilters] = useState(initialFilters);
  const [group, setGroup] = useState<Group>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [failureHeading, setFailureHeading] = useState('Group unavailable');
  const [saved, setSaved] = useState('');
  const generation = useRef(0),
    live = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedStatus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!saved || busy) return;
    const frame = requestAnimationFrame(() => {
      if (live.current && scope.isLive()) savedStatus.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [saved, busy, scope]);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const read = async () => {
    request.current?.unsubscribe();
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    setGroup(undefined);
    return new Promise<void>((resolve) => {
      request.current = fetchQuery<journeyWorkspaceQuery>(
        scope.environment,
        groupDocument,
        workspaceRequest(id, tab, initialFilters, !!expense, repayment)
          .variables,
        { fetchPolicy: 'network-only' },
      ).subscribe({
        next: (result) => {
          if (!live.current || !scope.isLive() || generation.current !== ticket)
            return;
          const routeSpace =
            result.group?.__typename === 'Group' && result.group.id === id
              ? result.group
              : undefined;
          if (!household && routeSpace) {
            const canonical = spaceHref(routeSpace);
            const currentBase = `${pathname.startsWith('/trips/') ? '/trips' : '/groups'}/${encodeURIComponent(id)}`;
            if (canonical !== currentBase) {
              const tail = expense
                ? `/expenses/${encodeURIComponent(expense)}`
                : repayment
                  ? '/repayments/new'
                  : '';
              const query = params.toString();
              router.replace(
                routeSpace.isHousehold
                  ? householdLedgerHref(
                      new URLSearchParams(params),
                      expense,
                      repayment,
                    )
                  : `${canonical}${tail}${query ? `?${query}` : ''}`,
              );
              resolve();
              return;
            }
          }
          const ledger = result.groupExpenses
            ? readInlineData<expensesView$key>(
                expenseView,
                result.groupExpenses,
              )
            : undefined;
          const activity = result.groupActivity
            ? readInlineData<activityFeed$key>(
                activityFeed,
                result.groupActivity,
              )
            : undefined;
          if (
            result.group?.__typename === 'Group' &&
            result.group.id === id &&
            (!household || result.group.isHousehold) &&
            result.viewer?.__typename === 'Viewer' &&
            (tab !== 'expenses' ||
              !!expense ||
              repayment ||
              ledger?.__typename === 'ExpenseView') &&
            (tab !== 'activity' ||
              !!expense ||
              repayment ||
              activity?.__typename === 'ActivityConnection')
          ) {
            setLoadedFilters(initialFilters);
            setDestination(result);
            setGroup(result.group);
            setToday(result.viewer.today);
          } else {
            if (
              params.has('restore') &&
              !scope.restored.has(params.get('restore')!) &&
              result.group?.__typename === 'Problem' &&
              result.group.code === 'NOT_FOUND'
            )
              router.replace(
                `${household ? '/household' : pathname.startsWith('/trips/') ? '/trips' : '/groups'}?restore=${encodeURIComponent(params.get('restore')!)}`,
              );
            // Attribute composed failures to their owning read. Never reveal the
            // otherwise successful group's private fields while access is uncertain.
            let code = 'UNAVAILABLE';
            let heading = 'Group unavailable';
            if (result.group?.__typename === 'Problem') {
              code = result.group.code;
            } else if (
              result.group?.__typename === 'Group' &&
              result.group.id === id
            ) {
              if (result.viewer?.__typename !== 'Viewer') {
                heading = 'Account access unavailable';
                if (result.viewer && 'code' in result.viewer)
                  code = result.viewer.code;
                else if (result.viewer && 'state' in result.viewer)
                  code = result.viewer.state;
              } else if (tab === 'expenses') {
                heading = 'Expenses unavailable';
                if (ledger && 'code' in ledger) code = ledger.code;
              } else if (tab === 'activity') {
                heading = 'Activity unavailable';
                if (activity && 'code' in activity) code = activity.code;
              }
            }
            setFailureHeading(heading);
            setError(message(code));
          }
          setBusy(false);
          resolve();
        },
        error: (failure: Error) => {
          if (live.current && scope.isLive() && generation.current === ticket) {
            setFailureHeading('Workspace unavailable');
            setError(message(failure.message));
            setBusy(false);
          }
          resolve();
        },
      });
    });
  };
  useForegroundRefresh(
    () => {
      generation.current++;
      request.current?.unsubscribe();
      setGroup(undefined);
      setDestination(undefined);
      setError('');
      setBusy(true);
    },
    () => {
      void read();
    },
  );
  useEffect(() => {
    live.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) void read();
    });
    const foreground = () => {
      if (document.visibilityState === 'visible') void read();
    };
    const timer = setTimeout(foreground, 86400000 - (Date.now() % 86400000));
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      active = false;
      clearTimeout(timer);
      live.current = false;
      invalidate();
      request.current?.unsubscribe();
    };
    // id/scope are immutable for this keyed group visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scope, after]);
  return (
    <>
      {!household && !group && (
        <h1 ref={heading} tabIndex={-1} data-page-heading>
          {busy ? 'Group access' : failureHeading}
        </h1>
      )}
      {saved && (
        <p ref={savedStatus} role="status" tabIndex={-1}>
          {saved}
        </p>
      )}
      <button
        className="journey-refresh"
        aria-label="Refresh group and restart list"
        title="Refresh group and restart list"
        disabled={busy}
        onClick={() => {
          if (after) {
            const next = new URLSearchParams(params);
            next.delete('after');
            router.replace(
              `${household ? '/household/ledger' : `${pathname.startsWith('/trips/') ? '/trips' : '/groups'}/${encodeURIComponent(id)}`}?${next}`,
            );
          } else void read();
        }}
      >
        Refresh
      </button>
      {busy ? (
        <Skeleton label="Loading current authorized group data" />
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <Link
            href={
              household
                ? '/household'
                : pathname.startsWith('/trips/')
                  ? '/trips'
                  : '/groups'
            }
          >
            {household
              ? 'Back to Household'
              : pathname.startsWith('/trips/')
                ? 'Back to Trips'
                : 'Back to Groups'}
          </Link>
        </>
      ) : (
        group && (
          <>
            <RestoreSource scope={scope} allowed={[id]} />
            {household && group.viewerMembership.role === 'OWNER' && (
              <Link href={spaceInvitationsHref(group)}>
                Manage Household invitations
              </Link>
            )}
            {expense ? (
              <>
                {!household && (
                  <h1 data-page-heading tabIndex={-1}>
                    {group.name}
                  </h1>
                )}
                <ExpensePresentation
                  title="Expense detail"
                  onClose={() => {
                    const token = params.get('source');
                    const visit = token ? scope.visits.get(token) : undefined;
                    if (token) scope.restored.delete(token);
                    router.replace(
                      visit
                        ? `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${token}`
                        : `${spaceHref(group)}?tab=expenses`,
                      { scroll: false },
                    );
                  }}
                >
                  <p>Original source: {group.name}</p>
                  <ExpenseDetail
                    scope={scope}
                    group={id}
                    id={expense}
                    onCommitted={async () => {
                      setSaved(
                        'Expense edited. Current expense and balances are being refreshed.',
                      );
                      await read();
                    }}
                  />
                </ExpensePresentation>
              </>
            ) : (
              <GroupWorkspace
                onEditSaved={() =>
                  setSaved(
                    'Expense edit saved. Current expense and balances are a separate authorized refresh; any unavailable data below does not undo your edit.',
                  )
                }
                showTabs={false}
                showHeader={!household}
                initialView={
                  destination?.groupExpenses
                    ? {
                        filterText: loadedFilters,
                        reference: destination.groupExpenses,
                      }
                    : undefined
                }
                initialFeed={destination?.groupActivity}
                scope={scope}
                group={group}
                today={today}
                repayment={repayment}
                completed={repayment && !!saved}
                onRefresh={async () => {
                  await read();
                }}
                onDenied={() => {
                  setGroup(undefined);
                  setError(message('NOT_FOUND'));
                }}
                onCommitted={async () => {
                  setSaved(
                    'Repayment recorded once. No money was moved. Current balances and recent repayments are a separately authorized read.',
                  );
                  await read();
                }}
              />
            )}
          </>
        )
      )}
    </>
  );
}
