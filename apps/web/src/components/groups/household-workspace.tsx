'use client';

import { cx } from '../ui/classnames';

import { RichHelp, balanceHelp, shareHelp } from '@/components/rich-help';
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
import { AppIcon } from '@/components/workspace-identity';
import { CategoryIcon } from '@/components/financial/category';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useState } from 'react';
import { useFragment } from 'react-relay';
import { NetworkQuery } from '@/lib/relay/query';
import dashboardDocument, {
  type householdContentDashboard$data,
  type householdContentDashboard$key,
} from '@/lib/relay/__generated__/householdContentDashboard.graphql';
import document, {
  type householdWorkspaceQuery,
} from '@/lib/relay/__generated__/householdWorkspaceQuery.graphql';
import { ContentLoading } from '../ui/loading';
import type { householdMembersQuery } from '@/lib/relay/__generated__/householdMembersQuery.graphql';
import { HouseholdAccess } from './household-access';
import membersDocument from '@/lib/relay/__generated__/householdMembersQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { minor, money } from '@/lib/relay/money';
import { SummaryMetric, Money } from '../financial/presentation';
import {
  workspaceSections,
  type WorkspaceSection,
} from '../workspace/patterns';
import { ActivityFeed } from '@/components/activity/feed';
import { useFinancialSession } from './session';
import { ScopedLink, RestoreSource } from './navigation';
import {
  BalanceHeading,
  BalanceSummary,
  BalanceSources,
  SourceSummary,
  BalanceSection,
  ObligationRows,
  ObligationPreview,
} from './balance-sections';

import { useForegroundRefresh } from './foreground';

export type Dashboard = householdContentDashboard$data;
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

import invitationStyles from '../onboarding/invitations.module.css';
import financialStyles from '../financial/presentation.module.css';
import workspaceFeatureStyles from './workspace.module.css';
import householdFeatureStyles from './household-workspace.module.css';
import overviewFeatureStyles from './overview.module.css';
import categoryFeatureStyles from '../financial/category.module.css';
import balanceStyles from './balance-sections.module.css';

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
        <ContentLoading
          layout={
            current.toLowerCase() as
              'overview' | 'expenses' | 'balances' | 'activity' | 'members'
          }
        />
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
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const [accessState, setAccessState] = useState({ busy: true, error: false });
  const [memberState, setMemberState] = useState({ busy: true, error: false });
  const [denied, setDenied] = useState(false);
  const clear = () => {
    setAccessState({ busy: true, error: false });
    setMemberState({ busy: true, error: false });
    setDenied(false);
  };
  const reset = () => {
    scope.invalidate?.();
    clear();
    setVersion((v) => v + 1);
    setActive(true);
  };
  useForegroundRefresh(() => {
    clear();
    setActive(false);
  }, reset);
  const error =
    denied || accessState.error || memberState.error
      ? 'Household membership is unavailable. Refresh to check current access.'
      : '';
  const busy = !error && (accessState.busy || memberState.busy);
  const loading = <ContentLoading layout="members" />;
  const failure = (
    <HouseholdMembershipFailure onDenied={() => setDenied(true)} />
  );
  return (
    <WorkspaceLoading busy={busy}>
      <WorkspaceRefresh
        contentPending
        busy={busy}
        error={error}
        onRefresh={reset}
      />
      {active ? (
        <HouseholdAccess
          reuse={version === 0}
          key={version}
          scope={scope}
          fallback={loading}
          failure={failure}
          onState={setAccessState}
        >
          {(home) => (
            <NetworkQuery<householdMembersQuery>
              reuse={version === 0}
              key={home}
              scope={scope}
              document={membersDocument}
              variables={{ id: home }}
              fallback={loading}
              failure={failure}
              onState={setMemberState}
            >
              {(result) =>
                result.group.__typename === 'Group' &&
                result.group.id === home ? (
                  <HouseholdMembers
                    members={result.group}
                    scope={scope}
                    onRefresh={reset}
                  />
                ) : (
                  failure
                )
              }
            </NetworkQuery>
          )}
        </HouseholdAccess>
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function HouseholdMembershipFailure({ onDenied }: { onDenied: () => void }) {
  const report = useEffectEvent(onDenied);
  useEffect(() => {
    report();
  }, []);
  return (
    <p role="alert">
      Household membership is unavailable. Refresh to check current access.
    </p>
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
    <section
      data-ui="workspace-panel household-members members-panel form-region"
      className={cx(
        cx(workspaceFeatureStyles['workspace-panel'], 'household-members'),
        invitationStyles['members-panel'],
      )}
    >
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
/** Each authorization visit retains one query reference and no projection copy. */
function HouseholdSummaryRead({
  scope,
  current,
}: {
  scope: FinancialScope;
  current: WorkspaceSection;
}) {
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const [state, setState] = useState({ busy: true, error: false });
  const [domainError, setDomainError] = useState('');
  const [saved, setSaved] = useState(false);
  const invalidate = () => {
    setActive(false);
    setDomainError('');
    setState({ busy: true, error: false });
  };
  const reset = () => {
    scope.invalidate?.();
    setVersion((v) => v + 1);
    setActive(true);
    setDomainError('');
    setState({ busy: true, error: false });
  };
  useForegroundRefresh(invalidate, reset);
  const error =
    domainError ||
    (state.error
      ? 'Household data is unavailable. No zero balance or settled status can be established.'
      : '');
  const loading = (
    <ContentLoading layout={current === 'Balances' ? 'balances' : 'overview'} />
  );
  return (
    <WorkspaceLoading busy={state.busy}>
      {saved && (
        <p role="status">
          Expense edit saved. Current Household data is a separate authorized
          refresh; unavailable data does not undo your edit.
        </p>
      )}
      <WorkspaceRefresh
        contentPending
        busy={state.busy}
        error={error}
        onRefresh={reset}
      />
      {active ? (
        <NetworkQuery<householdWorkspaceQuery>
          reuse={version === 0}
          scope={scope}
          key={version}
          document={document}
          variables={{
            recent: current === 'Overview',
            balances: current === 'Balances' || current === 'Overview',
          }}
          fallback={loading}
          failure={
            <p role="alert">
              {error ||
                'Household data is unavailable. No zero balance or settled status can be established.'}
            </p>
          }
          onState={setState}
        >
          {(result) =>
            result.householdDashboard.__typename === 'HouseholdDashboard' &&
            result.householdDashboard.dashboard ? (
              <HouseholdProjection
                scope={scope}
                reference={result.householdDashboard.dashboard}
                current={current}
                recent={result.householdExpenses}
                onError={setDomainError}
                onRefresh={async () => {
                  setSaved(true);
                  reset();
                }}
                onUnavailable={() => {
                  invalidate();
                  setState({ busy: false, error: false });
                  setDomainError(
                    'Expense source access is unavailable. Refresh to check current access.',
                  );
                }}
              />
            ) : (
              <HouseholdFailure onError={setDomainError} />
            )
          }
        </NetworkQuery>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function HouseholdFailure({ onError }: { onError: (error: string) => void }) {
  const error =
    'Household access is unavailable. Refresh to check current access.';
  useEffect(() => {
    onError(error);
  }, [onError]);
  return <p role="alert">{error}</p>;
}
function HouseholdProjection({
  reference,
  scope,
  onError,
  ...props
}: Omit<Parameters<typeof HouseholdContent>[0], 'dashboard'> & {
  reference: householdContentDashboard$key;
  onError: (error: string) => void;
}) {
  const dashboard = useFragment(dashboardDocument, reference);
  if (!dashboard.spaces.some((space) => space.isHousehold))
    return <HouseholdFailure onError={onError} />;
  return (
    <>
      <HouseholdContent {...props} scope={scope} dashboard={dashboard} />
      <RestoreSource
        scope={scope}
        allowed={dashboard.spaces.map((s) => s.groupId)}
      />
    </>
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
          <ContentLoading layout="members" />
        )
      ) : current === 'Activity' ? (
        <ActivityFeed scope={scope} groupId="" />
      ) : current === 'Expenses' ? (
        <section data-ui="form-region">
          <h2>Expenses</h2>
          <p>Read your shared expenses.</p>
          {home && (
            <Link href={householdHref('Expenses')}>Open shared Expenses</Link>
          )}
        </section>
      ) : current === 'Balances' ? (
        <section
          data-ui="household-balance-view form-region"
          className={balanceStyles.view}
        >
          <BalanceHeading />
          <BalanceSummary
            currency="USD"
            positions={
              totals
                ? dashboard.spaces.map((space) =>
                    space.balances?.__typename === 'GroupBalances'
                      ? space.viewerNetMinor
                      : undefined,
                  )
                : [undefined]
            }
          />
          {totals && (
            <BalanceSources
              scope={scope}
              identities={dashboard.spaces.map(
                (space) => `household-${space.groupId}`,
              )}
            >
              {(open, change) => (
                <ul
                  data-ui="household-balances"
                  className={householdFeatureStyles['household-balances']}
                >
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
                        data-ui="household-balance"
                        data-position={state}
                      >
                        <BalanceSection
                          scope={scope}
                          identity={`household-${space.groupId}`}
                          open={open[`household-${space.groupId}`] ?? false}
                          onOpenChange={(value) =>
                            change(`household-${space.groupId}`, value)
                          }
                          summary={
                            <SourceSummary
                              name={space.name}
                              icon={
                                space.isHousehold
                                  ? 'home'
                                  : space.kind === 'TRIP'
                                    ? 'trip'
                                    : 'groups'
                              }
                              detail={
                                <>
                                  {detail}
                                  {net !== undefined && net !== 0n && (
                                    <>
                                      {' '}
                                      ·{' '}
                                      {money(space.viewerNetMinor!).replace(
                                        /^-/,
                                        '',
                                      )}{' '}
                                      {space.currency}
                                    </>
                                  )}
                                </>
                              }
                            />
                          }
                        >
                          {balances?.__typename === 'GroupBalances' ? (
                            <>
                              <p>
                                {balances.settled
                                  ? 'Everyone in this space is settled.'
                                  : 'This space has outstanding balances.'}
                              </p>
                              <h4>Who owes whom</h4>
                              {balances.obligations.length ? (
                                <ObligationRows
                                  scope={scope}
                                  space={{ ...space, id: space.groupId }}
                                  viewer={viewer}
                                  obligations={balances.obligations}
                                  eligible={(id) =>
                                    balances.obligations.some((obligation) =>
                                      [obligation.from, obligation.to].some(
                                        (member) =>
                                          member.id === id &&
                                          member.canParticipate,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <p>
                                  {balances.settled
                                    ? 'No repayments are needed in this space.'
                                    : 'Repayment suggestions are unavailable; this space still has outstanding balances.'}
                                </p>
                              )}
                            </>
                          ) : (
                            <p role="alert">
                              Balances are unavailable. This space cannot be
                              shown as settled.
                            </p>
                          )}
                          <ScopedLink
                            scope={scope}
                            id={`household-source-${space.groupId}`}
                            href={`${spaceHref({ id: space.groupId, isHousehold: space.isHousehold, kind: space.kind })}?tab=balances`}
                          >
                            Complete member positions and recorded repayments
                          </ScopedLink>
                        </BalanceSection>
                      </li>
                    );
                  })}
                </ul>
              )}
            </BalanceSources>
          )}
        </section>
      ) : (
        <>
          {totals && (
            <div
              data-ui="summary-row"
              className={cx(
                financialStyles['summary-row'],
                'household-summary',
              )}
            >
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
            <ObligationPreview
              scope={scope}
              sources={dashboard.spaces.map((space) => ({
                space: { ...space, id: space.groupId },
                viewer: space.viewerMembership.id,
                obligations:
                  space.balances?.__typename === 'GroupBalances'
                    ? space.balances.obligations
                    : undefined,
                eligible: (id) =>
                  space.balances?.__typename === 'GroupBalances' &&
                  space.balances.obligations.some((edge) =>
                    [edge.from, edge.to].some(
                      (member) => member.id === id && member.canParticipate,
                    ),
                  ),
              }))}
            />
          )}
          {totals && (
            <div
              data-ui="workspace-overview-columns"
              className={overviewFeatureStyles['workspace-overview-columns']}
            >
              <section data-ui="form-region">
                <div
                  data-ui="group-section-heading"
                  className={overviewFeatureStyles['group-section-heading']}
                >
                  <h2>Recent expenses</h2>
                  <Link href={householdHref('Expenses')}>View all</Link>
                </div>
                {recent?.__typename === 'ExpenseView' ? (
                  !recent.edges.length ? (
                    <div
                      data-ui="household-empty"
                      className={householdFeatureStyles['household-empty']}
                    >
                      <AppIcon name="expense" />
                      <p>
                        <strong>No shared expenses yet.</strong>
                      </p>
                      <p>When you add expenses, they’ll show up here.</p>
                    </div>
                  ) : (
                    <>
                      <p
                        data-ui="overview-month"
                        className={overviewFeatureStyles['overview-month']}
                      >
                        {overviewPeriod(recentDates)}
                      </p>
                      <ul
                        data-ui="group-expense-list"
                        className={overviewFeatureStyles['group-expense-list']}
                      >
                        {recent.edges.slice(0, 4).map(({ node, source }) => (
                          <li key={node.expenseId}>
                            <OverviewExpenseLink
                              scope={scope}
                              group={node.groupId}
                              id={node.expenseId}
                              href={spaceExpenseHref(source, node.expenseId)}
                            >
                              <CategoryIcon category={node.category} />
                              <span
                                data-ui="expense-row-copy"
                                className={
                                  overviewFeatureStyles['expense-row-copy']
                                }
                              >
                                <strong>{node.description}</strong>
                                <span
                                  data-ui="row-detail"
                                  className={financialStyles['row-detail']}
                                >
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
                              <span
                                data-ui="overview-expense-price"
                                className={
                                  overviewFeatureStyles[
                                    'overview-expense-price'
                                  ]
                                }
                              >
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
                data-ui="workspace-overview-balances"
                className={overviewFeatureStyles['workspace-overview-balances']}
                aria-label="Overview balances by space"
              >
                <h2>By group or trip</h2>
                <ul
                  data-ui="household-balances"
                  className={householdFeatureStyles['household-balances']}
                >
                  {dashboard.spaces.map((space) => (
                    <li key={space.groupId}>
                      <ScopedLink
                        scope={scope}
                        id={`overview-balance-${space.groupId}`}
                        href={`${spaceHref({ id: space.groupId, isHousehold: space.isHousehold, kind: space.kind })}?tab=balances`}
                      >
                        <span
                          data-ui={`category-icon category-icon--${space.kind === 'TRIP' ? 'home' : 'other'}`}
                          className={cx(
                            categoryFeatureStyles['category-icon'],
                            categoryFeatureStyles[
                              `category-icon--${space.kind === 'TRIP' ? 'home' : 'other'}`
                            ],
                          )}
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
                        <span
                          data-ui="household-space-copy"
                          className={
                            householdFeatureStyles['household-space-copy']
                          }
                        >
                          <strong>
                            {space.name} ·{' '}
                            {space.isHousehold
                              ? 'Household expenses'
                              : space.kind === 'TRIP'
                                ? 'Trip'
                                : 'Group'}
                          </strong>
                          <span
                            data-ui="row-detail"
                            className={financialStyles['row-detail']}
                          >
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
            <p
              data-ui="overview-count"
              className={overviewFeatureStyles['overview-count']}
            >
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
      data-ui={`signed-balance signed-balance--${net > 0n ? 'positive' : net < 0n ? 'negative' : 'zero'}`}
      className={cx(
        financialStyles['signed-balance'],
        financialStyles[
          `signed-balance--${net > 0n ? 'positive' : net < 0n ? 'negative' : 'zero'}`
        ],
      )}
    >
      <SummaryMetric
        label={<RichHelp label="Your balance">{balanceHelp}</RichHelp>}
        tone="net"
        icon={<AppIcon name="arrow-up-right" />}
        detail={
          <>
            <span
              data-ui="row-detail"
              className={financialStyles['row-detail']}
            >
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
