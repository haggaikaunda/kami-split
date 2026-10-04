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
import { money } from '@/lib/relay/money';
import { ExpenseForm } from './expense-form';
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
  trips = false,
  filter = 'all',
}: {
  initialGroup?: string;
  expense?: string;
  trips?: boolean;
  filter?: string;
}) {
  const access = useFinancialSession();
  const params = useSearchParams();
  return (
    <main className="financial-journey" id="page-content">
      <header>
        <Link href="/account">Kami Split · Account</Link>
        <h1 data-page-heading tabIndex={-1}>
          {trips ? 'Your trips' : initialGroup ? 'Your group' : 'Your groups'}
        </h1>
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
          <Link
            href={`/sign-in?next=${encodeURIComponent(initialGroup ? `/groups/${encodeURIComponent(initialGroup)}${expense ? `/expenses/${encodeURIComponent(expense)}` : ''}` : trips ? '/trips' : '/groups')}`}
          >
            Sign in
          </Link>{' '}
          with your invited account to see your groups.
        </p>
      ) : (
        <ViewerJourney
          key={`${access.scope.id}:${initialGroup}:${expense}:${trips}:${filter}:${params.toString()}`}
          scope={access.scope}
          initialGroup={initialGroup}
          expense={expense}
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
  trips,
  filter,
}: {
  scope: FinancialScope;
  initialGroup: string;
  expense: string;
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
        <Link
          href={`/groups/${encodeURIComponent(viewer.groups.find((item) => item.isHousehold)!.id)}`}
        >
          Household
        </Link>
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
          key={`${group}:${expense}`}
          scope={scope}
          id={group}
          today={viewer.today}
          expense={expense}
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
}: {
  scope: FinancialScope;
  id: string;
  today: string;
  expense: string;
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
      <h2 ref={heading} tabIndex={-1} data-page-heading>
        {group?.name ?? 'Group unavailable'}
      </h2>
      {saved && <p role="status">{saved}</p>}
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
            <p>
              {group.currency} ·{' '}
              {group.isHousehold
                ? 'Household'
                : group.kind === 'TRIP'
                  ? 'Trip'
                  : 'Group'}
            </p>
            {group.trip && (
              <p>
                {group.trip.destination} ·{' '}
                <time dateTime={group.trip.startDate}>
                  {group.trip.startDate}
                </time>{' '}
                –{' '}
                <time dateTime={group.trip.endDate}>{group.trip.endDate}</time>{' '}
                · {tripState(group.trip, today)}
              </p>
            )}
            <RestoreSource scope={scope} allowed={[id]} />
            {expense ? (
              <ExpenseDetail scope={scope} group={id} id={expense} />
            ) : (
              <>
                <BalancePanel group={group} />
                <section aria-labelledby="expenses-title">
                  <h2 id="expenses-title">Expenses</h2>
                  {!group.expenses ? (
                    <p role="alert">
                      The expense page failed to load. Restart the list; this
                      does not mean there are no expenses.
                    </p>
                  ) : (
                    <>
                      <p>
                        Bounded pages of 20. Complete balances above include all
                        group history, even expenses not loaded here.
                      </p>
                      {!group.expenses.edges.length ? (
                        <p>
                          {group.expenses.pageInfo.hasPreviousPage
                            ? 'No expenses in this page.'
                            : 'This group has no expenses.'}
                        </p>
                      ) : (
                        <ul className="financial-expenses">
                          {group.expenses.edges.map(
                            (edge) =>
                              edge && (
                                <li key={edge.node.id}>
                                  <h3>
                                    <ScopedLink
                                      scope={scope}
                                      id={`expense-${edge.node.id}`}
                                      href={`/groups/${encodeURIComponent(id)}/expenses/${encodeURIComponent(edge.node.id)}`}
                                    >
                                      {edge.node.description}
                                    </ScopedLink>
                                  </h3>
                                  <p>
                                    {money(edge.node.totalMinor)} ·{' '}
                                    {edge.node.effectiveDate} ·{' '}
                                    {edge.node.category}
                                  </p>
                                  <p>Paid by {edge.node.payer.displayName}</p>
                                  {edge.node.note && <p>{edge.node.note}</p>}
                                  <ul>
                                    {edge.node.allocations.map((share) => (
                                      <li key={share.participant.id}>
                                        {share.participant.displayName}:{' '}
                                        {money(share.amountMinor)}
                                      </li>
                                    ))}
                                  </ul>
                                </li>
                              ),
                          )}
                        </ul>
                      )}
                      {group.expenses.pageInfo.hasNextPage && (
                        <button
                          onClick={() =>
                            (() => {
                              const next = new URLSearchParams(params);
                              next.set(
                                'after',
                                group.expenses?.pageInfo.endCursor ?? '',
                              );
                              router.push(
                                `/groups/${encodeURIComponent(id)}?${next}`,
                              );
                            })()
                          }
                        >
                          Load more expenses
                        </button>
                      )}
                    </>
                  )}
                </section>
                <ExpenseForm
                  scope={scope}
                  group={id}
                  today={today}
                  payer={group.viewerMembership.id}
                  members={group.members}
                  onDenied={() => {
                    setGroup(undefined);
                    setError(message('NOT_FOUND'));
                  }}
                  onCommitted={async (expenseId) => {
                    setSaved(
                      `Expense saved once. Reference: ${expenseId}. Balances below are a separately authorized current read.`,
                    );
                    await read();
                  }}
                />
              </>
            )}
          </>
        )
      )}
    </>
  );
}
function BalancePanel({ group }: { group: Group }) {
  const balances = group.balances;
  if (balances.__typename !== 'GroupBalances')
    return (
      <section>
        <h2>Complete balances</h2>
        <p role="alert">
          Balances are unavailable. This group cannot be shown as settled.
        </p>
      </section>
    );
  return (
    <section aria-labelledby="balances-title">
      <h2 id="balances-title">Complete balances</h2>
      <p>
        Total expenses: <strong>{money(balances.totalExpenseMinor)} USD</strong>
      </p>
      <p>
        {balances.settled
          ? 'Settled: every individual net is zero.'
          : 'This group has outstanding balances.'}
      </p>
      <ul>
        {balances.positions.map((position) => (
          <li key={position.member.id}>
            <strong>{position.member.displayName}</strong>
            {position.member.status === 'INACTIVE' && ' (historical member)'}
            <p>
              Net: {money(position.netMinor)}. Positive means owed to them;
              negative means they owe.
            </p>
            <p>
              Paid {money(position.paidMinor)} · Share{' '}
              {money(position.owedMinor)} · Repayments sent{' '}
              {money(position.sentMinor)} · Received{' '}
              {money(position.receivedMinor)}
            </p>
          </li>
        ))}
      </ul>
      <h3>Simplified obligations</h3>
      <p>
        These follow each person’s complete net within this group. Original
        expense relationships remain history, not extra debts.
      </p>
      <ul>
        {balances.obligations.map((obligation) => (
          <li key={`${obligation.from.id}:${obligation.to.id}`}>
            {obligation.from.displayName} owes {obligation.to.displayName}{' '}
            {money(obligation.amountMinor)}
          </li>
        ))}
      </ul>
    </section>
  );
}
