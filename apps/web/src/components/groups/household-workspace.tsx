'use client';
import { spaceHref, spaceExpenseHref } from '@/lib/relay/space-routes';
import Link from 'next/link';
import { ScopedInvitations } from '@/components/onboarding/scoped-invitations';
import { AppIcon } from '@/components/workspace-identity';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import document, {
  type householdWorkspaceQuery,
} from '@/lib/relay/__generated__/householdWorkspaceQuery.graphql';
import { Skeleton } from '@/components/primitives';
import type { householdMembersQuery } from '@/lib/relay/__generated__/householdMembersQuery.graphql';
import { useHouseholdMembers } from './household-members';
import type { FinancialScope } from '@/lib/relay/environment';
import { minor, money } from '@/lib/relay/money';
import {
  SummaryMetric,
  Money,
  MemberBalanceRow,
  workspaceSections,
  type WorkspaceSection,
} from '@/components/primitives';
import { ActivityFeed } from '@/components/activity/feed';
import { useFinancialSession } from './session';
import { ScopedLink, RestoreSource } from './navigation';
import './journey.css';
import { useForegroundRefresh } from './foreground';
import './household-workspace.css';
export type Dashboard = Extract<
  householdWorkspaceQuery['response']['householdDashboard'],
  { readonly __typename: 'HouseholdDashboard' }
>;
type Totals = Extract<
  Dashboard['totals'],
  { readonly __typename: 'HouseholdDashboardTotals' }
>;
type Members = Extract<
  householdMembersQuery['response']['group'],
  { readonly __typename: 'Group' }
>;
type Recent = householdWorkspaceQuery['response']['householdExpenses'];
export { householdHref } from './household-frame';
import { householdHref } from './household-frame';
export function HouseholdWorkspace({
  activity = false,
}: {
  activity?: boolean;
}) {
  const access = useFinancialSession();
  const params = useSearchParams(),
    pathname = usePathname();
  const current = activity
    ? 'Activity'
    : (workspaceSections.find((t) => t.toLowerCase() === params.get('tab')) ??
      'Overview');
  return (
    <>
      {access.loading ? (
        <p role="status">Loading secure access…</p>
      ) : access.error ? (
        <p role="alert">{access.error}</p>
      ) : !access.scope ? (
        <p>
          <Link
            href={`/sign-in?next=${encodeURIComponent(pathname + '?' + params.toString())}`}
          >
            Sign in
          </Link>{' '}
          to see your Household.
        </p>
      ) : activity ? (
        <ActivityFeed key={access.scope.id} scope={access.scope} groupId="" />
      ) : (
        <HouseholdRead
          key={`${access.scope.id}:${pathname}:${params.toString()}`}
          scope={access.scope}
          current={current}
        />
      )}
    </>
  );
}
export function HouseholdRead({
  scope,
  current,
}: {
  scope: FinancialScope;
  current: WorkspaceSection;
}) {
  return current === 'Members' ? (
    <HouseholdMembersRead scope={scope} />
  ) : (
    <HouseholdSummaryRead
      key={`${scope.id}:${current}`}
      scope={scope}
      current={current}
    />
  );
}
function HouseholdMembersRead({ scope }: { scope: FinancialScope }) {
  const { members, error, reset } = useHouseholdMembers(scope);
  return (
    <>
      <button className="household-refresh" onClick={reset}>
        Refresh Household
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : members ? (
        <HouseholdMembers members={members} scope={scope} />
      ) : (
        <Skeleton label="Loading Household membership" />
      )}
    </>
  );
}
function HouseholdMembers({
  members,
  scope,
}: {
  members: Members;
  scope: FinancialScope;
}) {
  return (
    <section>
      <h2>Household members</h2>
      <p>
        Active Household members share this ledger and its full expense history.
        The overview also includes eligible groups and trips shared by every
        active Household member.
      </p>
      {members.members.map((m) => (
        <MemberBalanceRow key={m.id} name={m.displayName}>
          <p>
            {m.role === 'OWNER' ? 'Owner' : 'Member'} ·{' '}
            {m.status === 'ACTIVE' ? 'Active' : 'Historical membership'}
          </p>
        </MemberBalanceRow>
      ))}
      {members.viewerMembership.role === 'OWNER' && (
        <ScopedInvitations
          scope={scope}
          group={{ id: members.id, name: members.name }}
        />
      )}
    </section>
  );
}
/** Every visit and foreground refresh starts from an empty, network-only read. */
function HouseholdSummaryRead({
  scope,
  current,
}: {
  scope: FinancialScope;
  current: WorkspaceSection;
}) {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Dashboard>();
  const [recent, setRecent] = useState<Recent>();
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const invalidate = () => {
    generation.current++;
    request.current?.unsubscribe();
    setData(undefined);
    setRecent(undefined);
    setError('');
  };
  const reset = () => {
    invalidate();
    setVersion((v) => v + 1);
  };
  useForegroundRefresh(invalidate, () => setVersion((v) => v + 1));
  useEffect(() => {
    let active = true;
    const ticket = ++generation.current;
    const live = () =>
      active && scope.isLive() && ticket === generation.current;
    const failed = () => {
      if (live())
        setError(
          'Household data is unavailable. No zero balance or settled status can be established.',
        );
    };
    const dashboardRead = (request.current =
      fetchQuery<householdWorkspaceQuery>(
        scope.environment,
        document,
        { recent: current === 'Overview', balances: current === 'Balances' },
        { fetchPolicy: 'network-only' },
      ).subscribe({
        next: (result) => {
          if (!live()) return;
          if (result.householdDashboard.__typename !== 'HouseholdDashboard') {
            setError(
              'Household access is unavailable. Refresh to check current access.',
            );
            return;
          }
          const dashboard = result.householdDashboard;
          const home = dashboard.spaces.find((s) => s.isHousehold);
          if (!home) {
            setError('Household access is unavailable.');
            return;
          }
          setData(dashboard);
          setRecent(result.householdExpenses);
        },
        error: failed,
      }));
    return () => {
      active = false;
      // Unsubscribe prevents Relay from reusing a pre-revalidation inflight read.
      dashboardRead.unsubscribe();
    };
  }, [scope, current, version]);
  return (
    <>
      <button className="household-refresh" onClick={reset}>
        Refresh Household
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <Skeleton label="Loading current authorized Household data" />
      ) : (
        <>
          <HouseholdContent
            scope={scope}
            dashboard={data}
            current={current}
            recent={recent}
          />
          <RestoreSource
            scope={scope}
            allowed={data.spaces.map((s) => s.groupId)}
          />
        </>
      )}
    </>
  );
}
export function HouseholdContent({
  scope,
  dashboard,
  current,
  members,
  recent,
}: {
  scope: FinancialScope;
  dashboard: Dashboard;
  current: WorkspaceSection;
  members?: Members;
  recent?: Recent;
}) {
  const home = dashboard.spaces.find((s) => s.isHousehold);
  const totals =
    dashboard.state === 'COMPLETE' &&
    dashboard.totals?.__typename === 'HouseholdDashboardTotals'
      ? dashboard.totals
      : undefined;
  return (
    <>
      {dashboard.state === 'UNAVAILABLE' ? (
        <p role="status">
          Shared overview is unavailable. Refresh to check current access.{' '}
          {home && <Link href="/household/ledger">Open Household ledger</Link>}
        </p>
      ) : !totals ? (
        <p role="alert">
          The shared overview is incomplete. Complete totals are unavailable;
          this does not mean balances are zero.
        </p>
      ) : null}
      {current === 'Members' ? (
        <section>
          <h2>Household members</h2>
          <p>
            Active Household members share this ledger and its full expense
            history. The overview also includes eligible groups and trips shared
            by every active Household member.
          </p>
          {members ? (
            <>
              {members.members.map((m) => (
                <MemberBalanceRow key={m.id} name={m.displayName}>
                  <p>
                    {m.role === 'OWNER' ? 'Owner' : 'Member'} ·{' '}
                    {m.status === 'ACTIVE' ? 'Active' : 'Historical membership'}
                  </p>
                </MemberBalanceRow>
              ))}
              {members.viewerMembership.role === 'OWNER' && (
                <ScopedInvitations
                  scope={scope}
                  group={{ id: members.id, name: members.name }}
                />
              )}
            </>
          ) : (
            <p role="status">Loading Household membership…</p>
          )}
        </section>
      ) : current === 'Activity' ? (
        <ActivityFeed scope={scope} groupId="" />
      ) : current === 'Expenses' ? (
        <section>
          <h2>Expenses</h2>
          <p>Read complete shared expenses across eligible spaces.</p>
          {home && (
            <Link href={householdHref('Expenses')}>Open shared Expenses</Link>
          )}
        </section>
      ) : current === 'Balances' ? (
        <section>
          <h2>Where your balance comes from</h2>
          {totals && <HouseholdNet totals={totals} />}
          <p>
            Balances stay separate in their original spaces. A zero overall net
            does not settle open source balances.
          </p>
          <ul className="household-balances">
            {dashboard.spaces.map((space) => {
              const net =
                space.viewerNetMinor == null
                  ? undefined
                  : minor(space.viewerNetMinor);
              const state =
                net === undefined
                  ? 'unavailable'
                  : net > 0n
                    ? 'positive'
                    : net < 0n
                      ? 'negative'
                      : 'zero';
              const balances = space.balances;
              const viewer = space.viewerMembership.id;
              const parties =
                balances?.__typename === 'GroupBalances'
                  ? balances.obligations
                      .filter(
                        (o) =>
                          net !== undefined &&
                          (net > 0n
                            ? o.to.id === viewer
                            : net < 0n && o.from.id === viewer),
                      )
                      .map((o) =>
                        net! > 0n ? o.from.displayName : o.to.displayName,
                      )
                  : [];
              const detail =
                net === undefined
                  ? 'Balance unavailable'
                  : net > 0n
                    ? parties.length === 1
                      ? `${parties[0]} owes you`
                      : "You're owed in this space"
                    : net < 0n
                      ? parties.length === 1
                        ? `You owe ${parties[0]}`
                        : 'You owe in this space'
                      : balances?.__typename === 'GroupBalances' &&
                          balances.settled
                        ? space.sharedExpenseCount === '0'
                          ? 'No shared expenses · Settled'
                          : 'Settled'
                        : 'Your net is zero; this space has open balances';
              return (
                <li
                  key={space.groupId}
                  className={`household-balance--${state}`}
                >
                  <ScopedLink
                    scope={scope}
                    id={`household-source-${space.groupId}`}
                    href={`${spaceHref({ id: space.groupId, isHousehold: space.isHousehold, kind: space.kind })}?tab=balances`}
                  >
                    <span>
                      <strong className="household-source-name">
                        <AppIcon
                          name={
                            space.isHousehold
                              ? 'home'
                              : space.kind === 'TRIP'
                                ? 'trip'
                                : 'groups'
                          }
                        />
                        {space.name}
                      </strong>
                      <span className="ui-row-detail">{detail}</span>
                    </span>
                    <span>
                      {net === undefined ? (
                        'Unavailable'
                      ) : (
                        <Money
                          value={`${net > 0n ? '+' : ''}${money(space.viewerNetMinor!)}`}
                          currency={space.currency}
                        />
                      )}
                      <span aria-hidden="true"> →</span>
                    </span>
                  </ScopedLink>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <>
          {totals && (
            <div className="ui-summary-row household-summary">
              <SummaryMetric
                label="Total shared expenses"
                detail={`${totals.totalSharedExpenseCount} expenses`}
              >
                <Money
                  value={money(totals.totalSharedExpenseMinor)}
                  currency="USD"
                />
              </SummaryMetric>
              <HouseholdNet totals={totals} />
              <SummaryMetric
                label="Active spaces"
                detail="Home · Trips · Groups"
              >
                {totals.activeSpaceCount}
              </SummaryMetric>
            </div>
          )}
          {totals && (
            <section>
              <div className="group-section-heading">
                <h2>Recent expenses</h2>
                <Link href={householdHref('Expenses')}>View all expenses</Link>
              </div>
              {recent?.__typename === 'ExpenseView' ? (
                !recent.edges.length ? (
                  <div className="household-empty">
                    <AppIcon name="expense" />
                    <p>
                      <strong>No shared expenses yet.</strong>
                    </p>
                    <p>When you add expenses, they’ll show up here.</p>
                  </div>
                ) : (
                  <ul className="group-expense-list">
                    {recent.edges.map(({ node, source }) => (
                      <li key={node.id}>
                        <ScopedLink
                          scope={scope}
                          id={`household-expense-${node.id}`}
                          href={spaceExpenseHref(source, node.id)}
                        >
                          <AppIcon
                            name="expense"
                            className="recent-expense-icon"
                          />
                          <span className="expense-row-copy">
                            <strong>{node.description}</strong>
                            <span className="ui-row-detail">
                              {source.name} ·{' '}
                              {source.isHousehold
                                ? 'Home'
                                : source.kind === 'TRIP'
                                  ? 'Trip'
                                  : 'Group'}{' '}
                              ·{' '}
                              <time dateTime={node.effectiveDate}>
                                {node.effectiveDate}
                              </time>
                            </span>
                          </span>
                          <Money
                            value={money(node.totalMinor)}
                            currency={source.currency}
                          />
                        </ScopedLink>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p role="alert">
                  Recent expenses are unavailable. This does not mean there are
                  no expenses.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
function HouseholdNet({ totals }: { totals: Totals }) {
  const net = minor(totals.viewerNetMinor);
  return (
    <div
      className={`ui-signed-balance ui-signed-balance--${net > 0n ? 'positive' : net < 0n ? 'negative' : 'zero'}`}
    >
      <SummaryMetric
        label="Your net balance"
        detail={
          <>
            <span className="ui-row-detail">
              <span aria-hidden="true">
                {net > 0n ? '↗ ' : net < 0n ? '↘ ' : '○ '}
              </span>
              {net > 0n
                ? "Overall, you're owed"
                : net < 0n
                  ? 'Overall, you owe'
                  : totals.openBalanceCount !== '0'
                    ? 'Overall net is zero; source balances remain open'
                    : 'No open source balances'}
            </span>
          </>
        }
      >
        <Money value={money(totals.viewerNetMinor)} currency="USD" />
      </SummaryMetric>
    </div>
  );
}
