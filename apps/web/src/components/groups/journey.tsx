'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import viewerDocument, {
  type journeyViewerQuery,
} from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
import groupDocument, {
  type journeyGroupQuery,
} from '@/lib/relay/__generated__/journeyGroupQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
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
export function GroupJourney() {
  const access = useFinancialSession();
  return (
    <main className="financial-journey" id="page-content">
      <header>
        <Link href="/account">Kami Split · Account</Link>
        <h1>Your groups</h1>
        <p>Persisted expenses and complete balances</p>
      </header>
      {access.loading ? (
        <p role="status">Loading secure access…</p>
      ) : access.error ? (
        <p role="alert">{access.error}</p>
      ) : !access.scope ? (
        <p>
          <Link href="/sign-in">Sign in</Link> with your invited account to see
          your groups.
        </p>
      ) : (
        <ViewerJourney key={access.scope.id} scope={access.scope} />
      )}
    </main>
  );
}
function ViewerJourney({ scope }: { scope: FinancialScope }) {
  const [viewer, setViewer] = useState<Viewer>();
  const [error, setError] = useState('');
  const [group, setGroup] = useState('');
  const [version, setVersion] = useState(0);
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
  }, [scope, version]);
  if (error)
    return (
      <>
        <p role="alert">{error}</p>
        <button
          onClick={() => {
            setError('');
            setViewer(undefined);
            setGroup('');
            setVersion((v) => v + 1);
          }}
        >
          Refresh access
        </button>
      </>
    );
  if (!viewer) return <p role="status">Loading your groups…</p>;
  return (
    <>
      <p>Signed in as {viewer.displayName}</p>
      <nav aria-label="Group selection">
        {viewer.groups.map((item) => (
          <button
            key={item.id}
            aria-pressed={group === item.id}
            onClick={() => setGroup(item.id)}
          >
            {item.name}
          </button>
        ))}
      </nav>
      {!viewer.groups.length ? (
        <p>
          You have no admitted groups. Open your invitation and explicitly join
          to continue.
        </p>
      ) : (
        !group && <p>Choose a group to view its expenses and balances.</p>
      )}
      {group && (
        <GroupDetails
          key={group}
          scope={scope}
          id={group}
          today={viewer.today}
        />
      )}
    </>
  );
}
function GroupDetails({
  scope,
  id,
  today,
}: {
  scope: FinancialScope;
  id: string;
  today: string;
}) {
  const [group, setGroup] = useState<Group>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState('');
  const generation = useRef(0),
    live = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = async (after?: string | null) => {
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    setGroup(undefined);
    try {
      const result = await fetchQuery<journeyGroupQuery>(
        scope.environment,
        groupDocument,
        { id, after },
        { fetchPolicy: 'network-only' },
      ).toPromise();
      if (!live.current || !scope.isLive() || generation.current !== ticket)
        return;
      if (result?.group.__typename === 'Group') setGroup(result.group);
      else
        setError(
          message(
            result && 'code' in result.group
              ? result.group.code
              : 'UNAVAILABLE',
          ),
        );
    } catch (failure) {
      if (live.current && scope.isLive() && generation.current === ticket)
        setError(message((failure as Error).message));
    } finally {
      if (live.current && generation.current === ticket) {
        setBusy(false);
        requestAnimationFrame(() => heading.current?.focus());
      }
    }
  };
  useEffect(() => {
    live.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) void read();
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
  }, [id, scope]);
  return (
    <>
      <h2 ref={heading} tabIndex={-1}>
        {group?.name ?? 'Group expenses'}
      </h2>
      {saved && <p role="status">{saved}</p>}
      <button disabled={busy} onClick={() => void read()}>
        Refresh group and restart list
      </button>
      {busy ? (
        <p role="status">Loading current authorized group data…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        group && (
          <>
            <BalancePanel group={group} />
            <section aria-labelledby="expenses-title">
              <h2 id="expenses-title">Expenses</h2>
              {!group.expenses ? (
                <p role="alert">
                  The expense page failed to load. Restart the list; this does
                  not mean there are no expenses.
                </p>
              ) : (
                <>
                  <p>
                    Bounded pages of 20. Complete balances above include all
                    group history, even expenses not loaded here.
                  </p>
                  {!group.expenses.edges.length ? (
                    <p>No expenses in this page.</p>
                  ) : (
                    <ul className="financial-expenses">
                      {group.expenses.edges.map(
                        (edge) =>
                          edge && (
                            <li key={edge.node.id}>
                              <h3>{edge.node.description}</h3>
                              <p>
                                {money(edge.node.totalMinor)} ·{' '}
                                {edge.node.effectiveDate} · {edge.node.category}
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
                        void read(group.expenses?.pageInfo.endCursor)
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
