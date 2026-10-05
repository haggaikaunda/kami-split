'use client';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import viewerDocument, {
  type journeyViewerQuery,
} from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
import groupDocument, {
  type journeyGroupQuery,
} from '@/lib/relay/__generated__/journeyGroupQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { ScopedLink, RestoreSource, SourceReturn } from './navigation';
import { tripState } from '@/lib/relay/discovery';
import { ExpenseDetail } from './expense-detail';
import { GroupWorkspace } from './workspace';
import { useFinancialSession } from './session';
import './journey.css';
type Viewer = Extract<
  journeyViewerQuery['response']['viewer'],
  { readonly __typename: 'Viewer' }
>;
type Group = Extract<
  journeyGroupQuery['response']['group'],
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
  initialGroup = '',
  expense = '',
  repayment = false,
  trips = false,
  filter = 'all',
}: {
  initialGroup?: string;
  expense?: string;
  repayment?: boolean;
  trips?: boolean;
  filter?: string;
}) {
  const access = useFinancialSession();
  const params = useSearchParams(),
    pathname = usePathname();
  const returnQuery = new URLSearchParams();
  for (const key of ['tab', 'sender', 'recipient', 'amount']) {
    const value = params.get(key);
    if (value) returnQuery.set(key, value);
  }
  const signInReturn = pathname + (returnQuery.size ? `?${returnQuery}` : '');
  return (
    <main
      className={`financial-journey ${initialGroup ? 'group-workspace' : ''}`}
      id="page-content"
    >
      <header>
        <Link href="/account">Kami Split · Account</Link>
        {!initialGroup && (
          <h1 data-page-heading tabIndex={-1}>
            {trips ? 'Your trips' : initialGroup ? 'Your group' : 'Your groups'}
          </h1>
        )}
        <nav aria-label="Financial navigation">
          <Link href="/groups">Groups</Link>
          <Link href="/trips">Trips</Link>
        </nav>
        <p>Persisted expenses and complete balances</p>
      </header>
      {access.loading ? (
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
      ) : (
        <ViewerJourney
          key={`${access.scope.id}:${initialGroup}:${expense}:${repayment}:${trips}:${filter}:${pathname}:${params.toString()}`}
          scope={access.scope}
          initialGroup={initialGroup}
          expense={expense}
          repayment={repayment}
          trips={trips}
          filter={filter}
        />
      )}
    </main>
  );
}
function ViewerJourney({
  scope,
  initialGroup,
  expense,
  repayment,
  trips,
  filter,
}: {
  scope: FinancialScope;
  initialGroup: string;
  expense: string;
  repayment: boolean;
  trips: boolean;
  filter: string;
}) {
  const [viewer, setViewer] = useState<Viewer>();
  const [error, setError] = useState('');
  const group = initialGroup;
  const [version, setVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const pathname = usePathname(),
    params = useSearchParams();
  const visit = pathname + '?' + params.toString();
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
  return (
    <>
      <p>Signed in as {viewer.displayName}</p>
      {group && <SourceReturn scope={scope} />}
      {viewer.groups.find((item) => item.isHousehold) && (
        <Link href="/household">Household</Link>
      )}
      {!group && (
        <>
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
          {!viewer.groups.length ? (
            <p>
              You have no admitted groups.{' '}
              {viewer.canCreateGroups
                ? 'Group creation will be available separately.'
                : 'Open your invitation and explicitly join to continue.'}
            </p>
          ) : (
            <ul>
              {viewer.groups
                .filter(
                  (item) =>
                    !trips ||
                    (item.kind === 'TRIP' &&
                      item.trip &&
                      (filter === 'all' ||
                        tripState(item.trip, viewer.today).toLowerCase() ===
                          filter)),
                )
                .map((item) => (
                  <li key={item.id}>
                    {item.trip && (
                      <div
                        className="financial-cover"
                        role="img"
                        aria-label="Abstract trip cover"
                      >
                        ◇
                      </div>
                    )}
                    <ScopedLink
                      scope={scope}
                      id={`group-${item.id}`}
                      href={`/groups/${encodeURIComponent(item.id)}`}
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
          {!!viewer.groups.length &&
            trips &&
            !viewer.groups.some(
              (item) =>
                item.kind === 'TRIP' &&
                item.trip &&
                (filter === 'all' ||
                  tripState(item.trip, viewer.today).toLowerCase() === filter),
            ) && <p>No trips match this filter.</p>}
          <RestoreSource
            scope={scope}
            allowed={viewer.groups.map((item) => item.id)}
          />
        </>
      )}
      {group && (
        <GroupDetails
          key={`${group}:${expense}:${repayment}`}
          scope={scope}
          id={group}
          today={viewer.today}
          expense={expense}
          repayment={repayment}
        />
      )}
    </>
  );
}
function GroupDetails({
  scope,
  id,
  today,
  expense,
  repayment,
}: {
  scope: FinancialScope;
  id: string;
  today: string;
  expense: string;
  repayment: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const after = params.get('after');
  const [group, setGroup] = useState<Group>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
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
  const read = async (cursor?: string | null) => {
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    setGroup(undefined);
    try {
      const result = await fetchQuery<journeyGroupQuery>(
        scope.environment,
        groupDocument,
        { id, after: cursor },
        { fetchPolicy: 'network-only' },
      ).toPromise();
      if (!live.current || !scope.isLive() || generation.current !== ticket)
        return;
      if (result?.group.__typename === 'Group' && result.group.id === id)
        setGroup(result.group);
      else {
        if (
          params.has('restore') &&
          !scope.restored.has(params.get('restore')!) &&
          result?.group.__typename === 'Problem' &&
          result.group.code === 'NOT_FOUND'
        )
          router.replace(
            `/groups?restore=${encodeURIComponent(params.get('restore')!)}`,
          );
        setError(
          message(
            result && 'code' in result.group
              ? result.group.code
              : 'UNAVAILABLE',
          ),
        );
      }
    } catch (failure) {
      if (live.current && scope.isLive() && generation.current === ticket)
        setError(message((failure as Error).message));
    } finally {
      if (live.current && generation.current === ticket) {
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) void read(after);
    });
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      active = false;
      live.current = false;
      invalidate();
    };
    // id/scope are immutable for this keyed group visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scope, after]);
  return (
    <>
      {!group && (
        <h1 ref={heading} tabIndex={-1} data-page-heading>
          {busy ? 'Group access' : 'Group unavailable'}
        </h1>
      )}
      {saved && (
        <p ref={savedStatus} role="status" tabIndex={-1}>
          {saved}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() => {
          if (after) {
            const next = new URLSearchParams(params);
            next.delete('after');
            router.replace(`/groups/${encodeURIComponent(id)}?${next}`);
          } else void read();
        }}
      >
        Refresh group and restart list
      </button>
      {busy ? (
        <p role="status">Loading current authorized group data…</p>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <Link href="/groups">Back to Groups</Link>
        </>
      ) : (
        group && (
          <>
            <RestoreSource scope={scope} allowed={[id]} />
            {expense ? (
              <>
                <h1 data-page-heading tabIndex={-1}>
                  {group.name}
                </h1>
                <ExpenseDetail scope={scope} group={id} id={expense} />
              </>
            ) : (
              <GroupWorkspace
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
