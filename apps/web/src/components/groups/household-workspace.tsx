'use client';
import {
  RichHelp,
  BalanceExplanation,
  balanceHelp,
  shareHelp,
} from '@/components/rich-help';
import { WorkspaceLoading } from '@/components/workspace-loading';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import {
  overviewDate,
  overviewPeriod,
  overviewSpansYears,
} from './overview-date';
import { spaceHref, spaceExpenseHref } from '@/lib/relay/space-routes';
import Link from 'next/link';
import { PeopleList } from '@/components/onboarding/people-list';
import { ScopedInvitations } from '@/components/onboarding/scoped-invitations';
import { OverviewExpense, OverviewExpenseLink } from './overview-expense';
import { AppIcon, CategoryIcon } from '@/components/workspace-identity';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
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
  const router = useRouter();
  const params = useSearchParams(),
    pathname = usePathname();
  const visitParams = new URLSearchParams(params);
  visitParams.delete('activityKind');
  visitParams.delete('expense');
  visitParams.delete('expenseGroup');
  visitParams.delete('detailSource');
  const current = activity
    ? 'Activity'
    : (workspaceSections.find((t) => t.toLowerCase() === params.get('tab')) ??
      'Overview');
  return (
    <>
      {access.loading ? (
        <p role="status">Loading workspace…</p>
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
        <ActivityFeed
          key={access.scope.id}
          scope={access.scope}
          groupId=""
          kind={params.get('activityKind') ?? ''}
          onKindChange={(kind) => {
            const next = new URLSearchParams(params);
            if (kind) next.set('activityKind', kind);
            else next.delete('activityKind');
            router.replace(`${pathname}?${next}`, { scroll: false });
          }}
        />
      ) : (
        <HouseholdRead
          key={`${access.scope.id}:${pathname}:${visitParams.toString()}`}
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
    <WorkspaceLoading busy={!members && !error}>
      <WorkspaceRefresh
        busy={!members && !error}
        error={error}
        onRefresh={reset}
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : members ? (
        <HouseholdMembers members={members} scope={scope} onRefresh={reset} />
      ) : (
        <Skeleton label="Loading Household membership" />
      )}
    </WorkspaceLoading>
  );
}
function HouseholdMembers({
  members,
  scope,
  onRefresh,
}: {
  members: Members;
  scope: FinancialScope;
  onRefresh?: () => void | Promise<void>;
}) {
  return (
    <section className="workspace-panel household-members members-panel">
      <h2>Household members</h2>
      <p>
        Active Household members share this ledger and its full expense history.
      </p>
      {members.viewerMembership.role === 'OWNER' ? (
        <ScopedInvitations
          scope={scope}
          group={{ id: members.id, name: members.name }}
          members={members.members}
          onRefresh={onRefresh}
        />
      ) : (
        <>
          <PeopleList members={members.members} />
          <p>Ask the owner to invite someone to this Household.</p>
        </>
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
  const [saved, setSaved] = useState(false);
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
    <WorkspaceLoading busy={!data && !error}>
      {saved && (
        <p role="status">
          Expense edit saved. Current Household data is a separate authorized
          refresh; unavailable data does not undo your edit.
        </p>
      )}
      <WorkspaceRefresh
        busy={!data && !error}
        error={error}
        onRefresh={reset}
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <Skeleton label="Loading Household" />
      ) : (
        <>
          <HouseholdContent
            scope={scope}
            dashboard={data}
            current={current}
            recent={recent}
            onRefresh={async () => {
              setSaved(true);
              reset();
            }}
            onUnavailable={() => {
              invalidate();
              setError(
                'Expense source access is unavailable. Refresh to check current access.',
              );
            }}
          />
          <RestoreSource
            scope={scope}
            allowed={data.spaces.map((s) => s.groupId)}
          />
        </>
      )}
    </WorkspaceLoading>
  );
}
export function HouseholdContent({
  scope,
  dashboard,
  current,
  members,
  recent,
  onRefresh,
  onUnavailable,
}: {
  scope: FinancialScope;
  dashboard: Dashboard;
  current: WorkspaceSection;
  members?: Members;
  recent?: Recent;
  onRefresh?: () => Promise<void>;
  onUnavailable?: () => void;
}) {
  const home = dashboard.spaces.find((s) => s.isHousehold);
  const recentDates =
    recent?.__typename === 'ExpenseView'
      ? recent.edges.slice(0, 4).map(({ node }) => node.effectiveDate)
      : [];
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
        members ? (
          <HouseholdMembers
            members={members}
            scope={scope}
            onRefresh={onRefresh}
          />
        ) : (
          <p role="status">Loading Household membership…</p>
        )
      ) : current === 'Activity' ? (
        <ActivityFeed scope={scope} groupId="" />
      ) : current === 'Expenses' ? (
        <section>
          <h2>Expenses</h2>
          <p>Read your shared expenses.</p>
          {home && (
            <Link href={householdHref('Expenses')}>Open shared Expenses</Link>
          )}
        </section>
      ) : current === 'Balances' ? (
        <section className="workspace-panel">
          <h2>Your balance</h2>
          {totals && <HouseholdNet totals={totals} />}
          <BalanceExplanation household />
          <h3>By group or trip</h3>
          {totals && (
            <ul className="household-balances">
              {dashboard.spaces.map((space) => {
                const net =
                  space.viewerNetMinor == null ||
                  space.balances?.__typename !== 'GroupBalances'
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
                          : 'Nothing to pay or collect · Other members still owe each other';
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
                        <strong
                          className={`household-source-name household-source-name--${space.kind === 'TRIP' ? 'trip' : 'group'}`}
                        >
                          <AppIcon
                            name={
                              space.isHousehold
                                ? 'home'
                                : space.kind === 'TRIP'
                                  ? 'trip'
                                  : 'groups'
                            }
                          />
                          {space.name} ·{' '}
                          {space.isHousehold
                            ? 'Household expenses'
                            : space.kind === 'TRIP'
                              ? 'Trip'
                              : 'Group'}
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
          )}
        </section>
      ) : (
        <>
          {totals && (
            <div className="ui-summary-row household-summary">
              <SummaryMetric
                label="Total shared expenses"
                tone="total"
                icon={<AppIcon name="expense" />}
                detail="USD"
              >
                <Money
                  value={money(totals.totalSharedExpenseMinor)}
                  currency="USD"
                />
              </SummaryMetric>
              <HouseholdNet totals={totals} />
              <SummaryMetric
                label={<RichHelp label="Your share">{shareHelp}</RichHelp>}
                tone="share"
                icon={<AppIcon name="pie" />}
                detail={`You paid ${money(totals.viewerPaidMinor)}`}
              >
                <Money value={money(totals.viewerShareMinor)} currency="USD" />
              </SummaryMetric>
            </div>
          )}
          {totals && (
            <div className="workspace-overview-columns">
              <section>
                <div className="group-section-heading">
                  <h2>Recent expenses</h2>
                  <Link href={householdHref('Expenses')}>View all</Link>
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
                    <>
                      <p className="overview-month">
                        {overviewPeriod(recentDates)}
                      </p>
                      <ul className="group-expense-list">
                        {recent.edges.slice(0, 4).map(({ node, source }) => (
                          <li key={node.expenseId}>
                            <OverviewExpenseLink
                              scope={scope}
                              group={node.groupId}
                              id={node.expenseId}
                              href={spaceExpenseHref(source, node.expenseId)}
                            >
                              <CategoryIcon category={node.category} />
                              <span className="expense-row-copy">
                                <strong>{node.description}</strong>
                                <span className="ui-row-detail">
                                  {source.name} ·{' '}
                                  <time dateTime={node.effectiveDate}>
                                    {overviewDate(
                                      node.effectiveDate,
                                      false,
                                      overviewSpansYears(recentDates),
                                    )}
                                  </time>
                                </span>
                              </span>
                              <span className="overview-expense-price">
                                <Money
                                  value={money(node.totalMinor)}
                                  currency={source.currency}
                                />
                                <small>
                                  Your share{' '}
                                  {money(
                                    node.allocations.find(
                                      (allocation) =>
                                        allocation.participant.id ===
                                        dashboard.spaces.find(
                                          (space) =>
                                            space.groupId === node.groupId,
                                        )?.viewerMembership.id,
                                    )?.amountMinor ?? '0',
                                  )}
                                </small>
                              </span>
                            </OverviewExpenseLink>
                          </li>
                        ))}
                      </ul>
                    </>
                  )
                ) : (
                  <p role="alert">
                    Recent expenses are unavailable. This does not mean there
                    are no expenses.
                  </p>
                )}
              </section>
              <aside
                className="workspace-overview-balances"
                aria-label="Overview balances by space"
              >
                <h2>By group or trip</h2>
                <ul className="household-balances">
                  {dashboard.spaces.map((space) => (
                    <li key={space.groupId}>
                      <ScopedLink
                        scope={scope}
                        id={`overview-balance-${space.groupId}`}
                        href={`${spaceHref({ id: space.groupId, isHousehold: space.isHousehold, kind: space.kind })}?tab=balances`}
                      >
                        <span
                          className={`category-icon category-icon--${space.kind === 'TRIP' ? 'home' : 'other'}`}
                        >
                          <AppIcon
                            name={
                              space.isHousehold
                                ? 'home'
                                : space.kind === 'TRIP'
                                  ? 'trip'
                                  : 'groups'
                            }
                          />
                        </span>
                        <span className="household-space-copy">
                          <strong>
                            {space.name} ·{' '}
                            {space.isHousehold
                              ? 'Household expenses'
                              : space.kind === 'TRIP'
                                ? 'Trip'
                                : 'Group'}
                          </strong>
                          <span className="ui-row-detail">
                            {space.viewerNetMinor == null
                              ? 'Unavailable'
                              : minor(space.viewerNetMinor) > 0n
                                ? "You're owed"
                                : minor(space.viewerNetMinor) < 0n
                                  ? 'You owe'
                                  : 'Nothing to pay or collect'}
                          </span>
                        </span>
                        {space.viewerNetMinor != null && (
                          <Money
                            value={money(space.viewerNetMinor)}
                            currency={space.currency}
                          />
                        )}
                      </ScopedLink>
                    </li>
                  ))}
                </ul>
                <Link href={householdHref('Balances')}>View all balances</Link>
              </aside>
            </div>
          )}
          {totals && (
            <p className="overview-count">
              <span>
                {totals.totalSharedExpenseCount} expenses across{' '}
                {totals.activeSpaceCount} spaces
              </span>
            </p>
          )}
          <OverviewExpense
            scope={scope}
            allowed={dashboard.spaces.map((s) => s.groupId)}
            sourceNames={Object.fromEntries(
              dashboard.spaces.map((s) => [s.groupId, s.name]),
            )}
            onCommitted={onRefresh ?? (async () => {})}
            onUnavailable={onUnavailable ?? (() => {})}
          />
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
        label={<RichHelp label="Your balance">{balanceHelp}</RichHelp>}
        tone="net"
        icon={<AppIcon name="arrow-up-right" />}
        detail={
          <>
            <span className="ui-row-detail">
              {net > 0n
                ? "You're owed overall"
                : net < 0n
                  ? 'You owe overall'
                  : totals.openBalanceCount !== '0'
                    ? 'Payments still to settle'
                    : 'Nothing to pay or collect'}
            </span>
          </>
        }
      >
        <Money value={money(totals.viewerNetMinor)} currency="USD" />
      </SummaryMetric>
    </div>
  );
}
