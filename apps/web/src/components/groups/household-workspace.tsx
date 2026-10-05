'use client';
import Link from 'next/link';
import { WorkspaceNavigation, AppIcon } from '@/components/workspace-identity';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import document, {
  type householdWorkspaceQuery,
} from '@/lib/relay/__generated__/householdWorkspaceQuery.graphql';
import membersDocument, {
  type householdMembersQuery,
} from '@/lib/relay/__generated__/householdMembersQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { minor, money } from '@/lib/relay/money';
import {
  WorkspaceHeader,
  WorkspaceTabs,
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
export function householdHref(section: WorkspaceSection) {
  if (section === 'Expenses') return '/household/expenses';
  return section === 'Activity'
    ? '/household/activity'
    : `/household?tab=${section.toLowerCase()}`;
}
export function HouseholdWorkspace({
  activity = false,
}: {
  activity?: boolean;
}) {
  const access = useFinancialSession();
  const router = useRouter();
  const params = useSearchParams(),
    pathname = usePathname();
  const current = activity
    ? 'Activity'
    : (workspaceSections.find((t) => t.toLowerCase() === params.get('tab')) ??
      'Overview');
  return (
    <main
      className="financial-journey group-workspace household-workspace"
      id="page-content"
    >
      <WorkspaceNavigation />
      <WorkspaceHeader
        title="Household"
        context="Shared expenses across home, trips and groups."
        appearance="household"
      />
      <div
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest('a');
          if (
            !link ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          event.preventDefault();
          router.push(link.getAttribute('href')!);
        }}
      >
        <WorkspaceTabs
          current={current}
          hrefFor={householdHref}
          label="Household workspace"
        />
      </div>
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
      ) : (
        <HouseholdRead
          key={`${access.scope.id}:${pathname}:${params.toString()}`}
          scope={access.scope}
          current={current}
        />
      )}
    </main>
  );
}
/** Every visit and foreground refresh starts from an empty, network-only read. */
export function HouseholdRead({
  scope,
  current,
}: {
  scope: FinancialScope;
  current: WorkspaceSection;
}) {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Dashboard>();
  const [members, setMembers] = useState<Members>();
  const [recent, setRecent] = useState<Recent>();
  const [error, setError] = useState('');
  const reset = () => {
    setData(undefined);
    setMembers(undefined);
    setRecent(undefined);
    setError('');
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    const foreground = () => {
      if (documentVisibility()) reset();
    };
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    window.document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      window.document.removeEventListener('visibilitychange', foreground);
    };
  }, []);
  useEffect(() => {
    let active = true;
    let memberRead: { unsubscribe(): void } | undefined;
    const live = () => active && scope.isLive();
    const failed = () => {
      if (live())
        setError(
          'Household data is unavailable. No zero balance or settled status can be established.',
        );
    };
    const dashboardRead = fetchQuery<householdWorkspaceQuery>(
      scope.environment,
      document,
      { recent: current === 'Overview' },
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
        if (current !== 'Members') {
          setData(dashboard);
          setRecent(result.householdExpenses);
          return;
        }
        memberRead = fetchQuery<householdMembersQuery>(
          scope.environment,
          membersDocument,
          { id: home.groupId },
          { fetchPolicy: 'network-only' },
        ).subscribe({
          next: (response) => {
            if (!live()) return;
            if (
              response.group.__typename !== 'Group' ||
              response.group.id !== home.groupId
            ) {
              setError(
                'Household membership is unavailable. Refresh to check current access.',
              );
              return;
            }
            setMembers(response.group);
            setData(dashboard);
          },
          error: failed,
        });
      },
      error: failed,
    });
    return () => {
      active = false;
      // Unsubscribe prevents Relay from reusing a pre-revalidation inflight read.
      dashboardRead.unsubscribe();
      memberRead?.unsubscribe();
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
        <p role="status">Loading current authorized Household data…</p>
      ) : (
        <>
          <HouseholdContent
            scope={scope}
            dashboard={data}
            current={current}
            members={members}
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
function documentVisibility() {
  return window.document.visibilityState === 'visible';
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
          Shared overview is not available yet.{' '}
          {home && (
            <Link href={`/groups/${encodeURIComponent(home.groupId)}`}>
              Open Household ledger
            </Link>
          )}
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
            These are the Household ledger members. The designated dashboard
            pair is separate and does not limit membership to two people.
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
                <Link href="/invitations">Manage invitations</Link>
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
                balances.__typename === 'GroupBalances'
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
                      : balances.__typename === 'GroupBalances' &&
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
                    href={`/groups/${encodeURIComponent(space.groupId)}?tab=balances`}
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
                detail={`${totals.totalSharedExpenseCount} expenses · repayments excluded`}
              >
                <Money
                  value={money(totals.totalSharedExpenseMinor)}
                  currency="USD"
                />
              </SummaryMetric>
              <HouseholdNet totals={totals} disclosure />
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
                  <p>No shared expenses yet.</p>
                ) : (
                  <ul className="group-expense-list">
                    {recent.edges.map(({ node, source }) => (
                      <li key={node.id}>
                        <ScopedLink
                          scope={scope}
                          id={`household-expense-${node.id}`}
                          href={`/groups/${encodeURIComponent(source.id)}/expenses/${encodeURIComponent(node.id)}`}
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
function HouseholdNet({
  totals,
  disclosure = false,
}: {
  totals: Totals;
  disclosure?: boolean;
}) {
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
                    ? 'Overall net is zero'
                    : 'No open source balances'}
            </span>
            {disclosure ? (
              <Link href={householdHref('Balances')}>
                {totals.openBalanceCount} open balances →
              </Link>
            ) : (
              <span>{totals.openBalanceCount} open balances</span>
            )}
          </>
        }
      >
        <Money value={money(totals.viewerNetMinor)} currency="USD" />
      </SummaryMetric>
    </div>
  );
}
