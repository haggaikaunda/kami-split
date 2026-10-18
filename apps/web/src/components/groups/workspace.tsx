'use client';

import { cx } from '../ui/classnames';

import { useExpenseEntry } from '@/components/expenses/entry';

import { calendarDate } from '@/lib/dates';
import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef } from 'react';
import {
  overviewDate,
  overviewPeriod,
  overviewSpansYears,
} from './overview-date';
import {
  spaceHref,
  spaceExpenseHref,
  spaceRepaymentHref,
} from '@/lib/relay/space-routes';
import { OverviewExpense, OverviewExpenseLink } from './overview-expense';
import { AppIcon } from '@/components/workspace-identity';
import { CategoryIcon } from '@/components/financial/category';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFragment } from 'react-relay';
import groupDocument, {
  type workspaceGroup$key,
  type workspaceGroup$data,
} from '@/lib/relay/__generated__/workspaceGroup.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { tripState } from '@/lib/relay/discovery';
import { minor, money } from '@/lib/relay/money';
import { Member } from '../ui/primitives';
import {
  Money,
  SignedBalanceMetric,
  SummaryMetric,
} from '../financial/presentation';
import {
  WorkspaceHeader,
  WorkspaceTabs,
  workspaceSections,
  type WorkspaceSection,
} from '../workspace/patterns';
import { ScopedLink } from './navigation';
import { ActivityFeed } from '@/components/activity/feed';
import type { expensesView$key } from '@/lib/relay/__generated__/expensesView.graphql';
import type { activityFeed$key } from '@/lib/relay/__generated__/activityFeed.graphql';
import { ExpenseLedger } from '@/components/expenses/ledger';
import { PeopleList } from '@/components/onboarding/people-list';
import { ScopedInvitations } from '@/components/onboarding/scoped-invitations';
import { RepaymentForm } from './repayment-form';
import { RepaymentPresentation } from './repayment-presentation';
import {
  BalanceHeading,
  BalanceSummary,
  SourceSummary,
  BalanceSection,
  ObligationRows,
  ObligationPreview,
} from './balance-sections';
import { RichHelp, balanceHelp, shareHelp } from '@/components/rich-help';
import type { journeyWorkspaceQuery } from '@/lib/relay/__generated__/journeyWorkspaceQuery.graphql';

import financialPaletteStyles from '../financial/presentation.module.css';
import invitationStyles from '../onboarding/invitations.module.css';
import workspaceStyles from '../workspace/patterns.module.css';
import financialStyles from '../financial/presentation.module.css';
import workspaceFeatureStyles from './workspace.module.css';
import overviewFeatureStyles from './overview.module.css';
import balanceStyles from './balance-sections.module.css';

/** The route validates and owns canonical workspace identity before rendering. */
type WorkspaceIdentity = Pick<
  Extract<
    journeyWorkspaceQuery['response']['group'],
    { readonly __typename: 'Group' }
  >,
  'id' | 'name' | 'kind' | 'isHousehold'
>;
export type WorkspaceGroup = workspaceGroup$data & WorkspaceIdentity;
export function GroupWorkspace({
  groupRef,
  identity,
  ...props
}: Omit<Parameters<typeof GroupWorkspaceContent>[0], 'group'> & {
  groupRef: workspaceGroup$key;
  identity: WorkspaceIdentity;
}) {
  const group = useFragment(groupDocument, groupRef);
  return <GroupWorkspaceContent {...props} group={{ ...group, ...identity }} />;
}
export function GroupWorkspaceContent({
  activityKind,
  onActivityReadState,
  onActivityKindChange,
  scope,
  group,
  today,
  repayment = false,
  showTabs = true,
  showHeader = true,
  headerTarget,
  actionTarget,
  initialView,
  initialFeed,
  completed = false,
  onCommitted,
  onEditSaved,
  onRefresh,
  onDenied,
}: {
  onActivityReadState?: (state: { busy: boolean; error: string }) => void;
  activityKind?: string;
  onActivityKindChange?: (kind: string) => void;
  scope: FinancialScope;
  group: WorkspaceGroup;
  today: string;
  repayment?: boolean;
  showTabs?: boolean;
  showHeader?: boolean;
  headerTarget?: HTMLDivElement | null;
  actionTarget?: HTMLDivElement | null;
  initialView?: { filterText: string; reference: expensesView$key };
  initialFeed?: activityFeed$key;
  completed?: boolean;
  onRefresh: () => Promise<void>;
  onCommitted: () => Promise<void>;
  onEditSaved?: () => void;
  onDenied: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const sourceToken = params.get('source');
  const sourceVisit = sourceToken ? scope.visits?.get(sourceToken) : undefined;
  const contextual = !!(
    repayment &&
    sourceVisit &&
    params.get('sender') &&
    params.get('recipient') &&
    params.get('amount')
  );
  const closeRepayment = () => {
    if (!sourceVisit || !sourceToken) return;
    scope.restored.delete(sourceToken);
    const target = new URL(sourceVisit.href, window.location.origin);
    target.searchParams.set('restore', sourceToken);
    router.replace(target.pathname + target.search, { scroll: false });
  };
  const repaymentForm = (
    <RepaymentForm
      scope={scope}
      group={group.id}
      name={group.name}
      today={today}
      sender={params.get('sender') ?? ''}
      recipient={params.get('recipient') ?? ''}
      suggested={params.get('amount') ?? ''}
      members={group.members}
      onCommitted={onCommitted}
      onDenied={onDenied}
      contextual={contextual}
      viewer={group.viewerMembership.id}
    />
  );
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    const host = element?.parentElement;
    if (!showHeader || !element || !host || host !== headerTarget) return;
    host.style.removeProperty('--workspace-header-height');
    host.style.removeProperty('min-height');
    return () => {
      // Layout cleanup runs before React hides/removes the private header.
      // Keep only geometry in the stable host, including its bottom margin.
      const height = element.getBoundingClientRect().height;
      if (!height) return;
      host.style.setProperty(
        'min-height',
        `${host.getBoundingClientRect().height}px`,
      );
      host.style.setProperty('--workspace-header-height', `${height}px`);
    };
  }, [headerTarget, showHeader]);
  const expenseEntry = useExpenseEntry();
  const requested = params.get('tab');
  const current: WorkspaceSection =
    workspaceSections.find((t) => t.toLowerCase() === requested) ??
    (params.has('after') ? 'Expenses' : 'Overview');
  const base = spaceHref(group);
  const hrefFor = (tab: WorkspaceSection) => `${base}?tab=${tab.toLowerCase()}`;
  const addParams =
    current === 'Expenses' && !repayment
      ? new URLSearchParams(params)
      : new URLSearchParams();
  for (const key of ['expense', 'expenseGroup', 'detailSource', 'after'])
    addParams.delete(key);
  addParams.set('tab', 'expenses');
  addParams.set('create', group.id);
  const activeMembers = group.members.filter((m) => m.status === 'ACTIVE');
  const addAction = (
    <Link
      onClick={(event) => expenseEntry?.activate(event, group.id)}
      id="workspace-add"
      scroll={false}
      data-ui="banner-action"
      className={workspaceStyles['banner-action']}
      href={`${base}?${addParams}`}
    >
      <AppIcon name="plus" /> Add expense
    </Link>
  );
  const workspaceHeader = (
    <WorkspaceHeader
      ref={header}
      title={group.name}
      appearance={
        group.trip ? 'trip' : group.isHousehold ? 'household' : 'group'
      }
      context={
        <RichHelp label="About this space">
          <Link
            data-ui="banner-members-link"
            className={workspaceFeatureStyles['banner-members-link']}
            href={hrefFor('Members')}
          >
            {activeMembers.length} members
          </Link>{' '}
          ·{' '}
          {group.trip
            ? 'Trip'
            : group.isHousehold
              ? 'Household expenses'
              : 'Group'}{' '}
          · {group.currency}
        </RichHelp>
      }
    >
      {!actionTarget && addAction}
    </WorkspaceHeader>
  );
  return (
    <div>
      {actionTarget && createPortal(addAction, actionTarget)}
      {showHeader &&
        (headerTarget
          ? createPortal(workspaceHeader, headerTarget)
          : workspaceHeader)}
      {showTabs && (
        <WorkspaceTabs
          current={repayment ? 'Balances' : current}
          hrefFor={hrefFor}
          label={`${group.name} workspace`}
        />
      )}

      {current === 'Members' && (
        <div
          data-ui="workspace-owner-actions"
          className={overviewFeatureStyles['workspace-owner-actions']}
        >
          {' '}
          {group.viewerMembership.role === 'OWNER' && (
            <div
              data-ui="group-header-actions"
              className={workspaceFeatureStyles['group-header-actions']}
            >
              <details
                data-ui="group-settings"
                className={workspaceFeatureStyles['group-settings']}
              >
                <summary>Group settings</summary>
                <p>
                  Name: {group.name} · Currency: {group.currency}
                </p>
                <p>
                  Membership and invitations are managed separately. Metadata
                  editing is not available in this workspace.
                </p>
              </details>
            </div>
          )}
        </div>
      )}
      {repayment && !completed ? (
        contextual ? (
          <>
            <GroupBalances scope={scope} group={group} />
            <RepaymentPresentation onClose={closeRepayment}>
              {repaymentForm}
            </RepaymentPresentation>
          </>
        ) : (
          repaymentForm
        )
      ) : completed || current === 'Balances' ? (
        <GroupBalances scope={scope} group={group} />
      ) : current === 'Overview' ? (
        <>
          <OverviewMetrics scope={scope} group={group} />
          <ObligationPreview
            scope={scope}
            sources={[
              {
                space: group,
                viewer: group.viewerMembership.id,
                obligations:
                  group.balances?.__typename === 'GroupBalances'
                    ? group.balances.obligations
                    : undefined,
                eligible: (id) =>
                  group.members.some(
                    (member) => member.id === id && member.canParticipate,
                  ),
              },
            ]}
          />
          <div
            data-ui="workspace-overview-columns"
            className={overviewFeatureStyles['workspace-overview-columns']}
          >
            <section
              aria-labelledby="recent-expenses-title"
              data-ui="form-region"
            >
              <div
                data-ui="group-section-heading"
                className={overviewFeatureStyles['group-section-heading']}
              >
                <h2 id="recent-expenses-title">Recent expenses</h2>
                <Link href={hrefFor('Expenses')}>View all</Link>
              </div>
              <Expenses scope={scope} group={group} recent />
            </section>
            <aside
              data-ui="workspace-overview-balances"
              className={overviewFeatureStyles['workspace-overview-balances']}
              aria-label="Overview member balances"
            >
              <h2>Balances</h2>
              <div
                data-ui="workspace-member-balances"
                className={cx(
                  overviewFeatureStyles['workspace-member-balances'],
                  financialPaletteStyles['member-palette'],
                )}
              >
                {group.balances?.__typename === 'GroupBalances' ? (
                  group.balances.positions.map((p) => (
                    <div
                      data-ui="balance-row"
                      className={financialStyles['balance-row']}
                      key={p.member.id}
                    >
                      <Member
                        name={p.member.displayName}
                        detail={
                          minor(p.netMinor) > 0n
                            ? 'Is owed'
                            : minor(p.netMinor) < 0n
                              ? 'Owes'
                              : 'Net zero'
                        }
                      />
                      <Money
                        value={money(p.netMinor).replace(/^-/, '')}
                        currency={group.currency}
                      />
                    </div>
                  ))
                ) : (
                  <p role="alert">Balances are unavailable.</p>
                )}
              </div>
              <p
                data-ui="overview-balance-note"
                className={overviewFeatureStyles['overview-balance-note']}
              >
                Complete balances · Not affected by expense filters.{' '}
                <Link href={hrefFor('Balances')}>View balance details</Link>
              </p>
            </aside>
          </div>
          <OverviewExpense
            scope={scope}
            allowed={[group.id]}
            sourceNames={{ [group.id]: group.name }}
            onCommitted={async () => {
              onEditSaved?.();
              await onRefresh();
            }}
            onUnavailable={onDenied}
          />
        </>
      ) : current === 'Expenses' ? (
        <>
          {group.isHousehold && <h2>Household expenses</h2>}
          <ExpenseLedger
            filterLayout={group.isHousehold ? 'household' : 'group'}
            initialView={initialView}
            managedRefresh={!showTabs}
            scope={scope}
            groupId={group.id}
            spaces={[
              {
                groupId: group.id,
                name: group.name,
                viewerMembership: group.viewerMembership,
                members: group.members,
              },
            ]}
            today={today}
            onDenied={onDenied}
            onRefreshContext={onRefresh}
            onEditSaved={onEditSaved}
          />
        </>
      ) : current === 'Members' ? (
        <section
          data-ui="workspace-panel members-panel form-region"
          className={cx(
            workspaceFeatureStyles['workspace-panel'],
            invitationStyles['members-panel'],
          )}
        >
          <h2>Members</h2>
          {group.trip && (
            <p
              data-ui="workspace-context-detail"
              className={workspaceFeatureStyles['workspace-context-detail']}
            >
              {group.trip.destination} ·{' '}
              <time dateTime={group.trip.startDate}>
                {calendarDate(group.trip.startDate)}
              </time>{' '}
              –{' '}
              <time dateTime={group.trip.endDate}>
                {calendarDate(group.trip.endDate)}
              </time>{' '}
              · {tripState(group.trip, today)}
            </p>
          )}
          {group.viewerMembership.role === 'OWNER' ? (
            <ScopedInvitations
              scope={scope}
              group={group}
              members={group.members}
              onRefresh={onRefresh}
            />
          ) : (
            <>
              <PeopleList members={group.members} />
              <p>Ask the owner to invite someone to this group.</p>
            </>
          )}
        </section>
      ) : (
        <ActivityFeed
          onReadState={onActivityReadState}
          kind={activityKind}
          onKindChange={onActivityKindChange}
          scope={scope}
          groupId={group.id}
          initialFeed={initialFeed}
          managedRefresh={!showTabs}
          onDenied={onDenied}
        />
      )}
    </div>
  );
}
function ViewerMetric({
  scope,
  group,
  disclosure = false,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
  disclosure?: boolean;
}) {
  const b = group.balances;
  const viewer =
    b?.__typename === 'GroupBalances'
      ? b.positions.find((p) => p.member.id === group.viewerMembership.id)
      : undefined;
  if (!viewer)
    return (
      <SummaryMetric
        label={<RichHelp label="Your balance">{balanceHelp}</RichHelp>}
      >
        <span role="alert">Balances are unavailable</span>
      </SummaryMetric>
    );
  const net = minor(viewer.netMinor),
    position = net > 0n ? 'positive' : net < 0n ? 'negative' : 'zero';
  return (
    <SignedBalanceMetric
      position={position}
      label={<RichHelp label="Your balance">{balanceHelp}</RichHelp>}
      value={money(viewer.netMinor)}
      currency={group.currency}
      detail={
        <>
          {net === 0n && b?.__typename === 'GroupBalances' && !b.settled
            ? 'Nothing to pay or collect. Other members still owe each other.'
            : net > 0n
              ? "You're owed"
              : net < 0n
                ? 'You owe'
                : 'Nothing to pay or collect'}
          {disclosure && (
            <ScopedLink
              scope={scope}
              id="view-balance"
              href={`${spaceHref(group)}?tab=balances`}
            >
              View balance
            </ScopedLink>
          )}
        </>
      }
    />
  );
}
function OverviewMetrics({
  scope,
  group,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
}) {
  const viewer =
    group.balances?.__typename === 'GroupBalances'
      ? group.balances.positions.find(
          (p) => p.member.id === group.viewerMembership.id,
        )
      : undefined;
  return (
    <div data-ui="summary-row" className={financialStyles['summary-row']}>
      <SummaryMetric
        label="Total spend"
        tone="total"
        detail={
          group.isHousehold
            ? `Household expenses · ${group.currency}`
            : group.currency
        }
        icon={<AppIcon name="expense" />}
      >
        {group.balances?.__typename === 'GroupBalances' ? (
          <Money
            value={money(group.balances.totalExpenseMinor)}
            currency={group.currency}
          />
        ) : (
          <span role="alert">Total spend unavailable</span>
        )}
      </SummaryMetric>
      <ViewerMetric scope={scope} group={group} />
      <SummaryMetric
        label={<RichHelp label="Your share">{shareHelp}</RichHelp>}
        tone="share"
        icon={<AppIcon name="pie" />}
        detail={
          viewer ? (
            <>
              You paid{' '}
              <Money
                value={money(viewer.paidMinor)}
                currency={group.currency}
              />
            </>
          ) : undefined
        }
      >
        {viewer ? (
          <Money value={money(viewer.owedMinor)} currency={group.currency} />
        ) : (
          <span role="alert">Your share is unavailable</span>
        )}
      </SummaryMetric>
    </div>
  );
}
function Expenses({
  scope,
  group,
  recent = false,
}: {
  group: WorkspaceGroup;
  recent?: boolean;
  scope: FinancialScope;
}) {
  const page = group.expenses;
  if (!page)
    return (
      <p role="alert">
        The expense page failed to load. Restart the list; this does not mean
        there are no expenses.
      </p>
    );
  if (!page.edges.length) return <p>This group has no expenses.</p>;
  const dates = page.edges
    .slice(0, recent ? 4 : undefined)
    .map(({ node }) => node.effectiveDate);
  return (
    <>
      <p
        data-ui="overview-month"
        className={overviewFeatureStyles['overview-month']}
      >
        {overviewPeriod(dates)}
      </p>
      <ul
        data-ui="group-expense-list"
        className={overviewFeatureStyles['group-expense-list']}
      >
        {(recent ? page.edges.slice(0, 4) : page.edges).map(
          (edge) =>
            edge && (
              <li key={edge.node.expenseId}>
                <OverviewExpenseLink
                  scope={scope}
                  group={group.id}
                  id={edge.node.expenseId}
                  href={spaceExpenseHref(group, edge.node.expenseId)}
                >
                  <CategoryIcon category={edge.node.category} />
                  <span
                    data-ui="expense-row-copy"
                    className={overviewFeatureStyles['expense-row-copy']}
                  >
                    <strong>{edge.node.description}</strong>
                    <span
                      data-ui="row-detail"
                      className={financialStyles['row-detail']}
                    >
                      {edge.node.payer.displayName} paid ·{' '}
                      <time dateTime={edge.node.effectiveDate}>
                        {overviewDate(
                          edge.node.effectiveDate,
                          false,
                          overviewSpansYears(dates),
                        )}
                      </time>
                    </span>
                  </span>
                  <span
                    data-ui="overview-expense-price"
                    className={overviewFeatureStyles['overview-expense-price']}
                  >
                    <Money
                      value={money(edge.node.totalMinor)}
                      currency={group.currency}
                    />
                    <small>
                      Your share{' '}
                      {money(
                        edge.node.allocations.find(
                          (allocation) =>
                            allocation.participant.id ===
                            group.viewerMembership.id,
                        )?.amountMinor ?? '0',
                      )}
                    </small>
                  </span>
                </OverviewExpenseLink>
              </li>
            ),
        )}
      </ul>
    </>
  );
}
export function GroupBalances({
  scope,
  group,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
}) {
  const b = group.balances;
  if (b?.__typename !== 'GroupBalances')
    return (
      <section
        data-ui="group-balances form-region"
        className={cx(
          workspaceFeatureStyles['group-balances'],
          balanceStyles.view,
        )}
      >
        <BalanceHeading />
        <BalanceSummary currency={group.currency} positions={[undefined]} />
        <p role="alert">
          Balances are unavailable. This group cannot be shown as settled.
        </p>
        <BalanceSection
          scope={scope}
          identity={`group-${group.id}-source`}
          initiallyOpen
          summary={
            <SourceSummary
              name={group.isHousehold ? 'Household expenses' : group.name}
              icon={
                group.isHousehold
                  ? 'home'
                  : group.kind === 'TRIP'
                    ? 'trip'
                    : 'groups'
              }
              detail="Balance unavailable"
            />
          }
        >
          <p>
            {group.members.length} members · {group.currency}
          </p>
          <Link href={`${spaceHref(group)}?tab=activity`}>
            View Activity and expense before/after history
          </Link>
          <GeneralRepaymentEntry scope={scope} group={group} />
          <RecentRepayments group={group} />
        </BalanceSection>
      </section>
    );
  const viewerPosition = b.positions.find(
    (p) => p.member.id === group.viewerMembership.id,
  );
  const viewerNet = viewerPosition ? minor(viewerPosition.netMinor) : undefined;
  const sourceStatus =
    viewerNet === undefined
      ? 'Your balance is unavailable'
      : viewerNet < 0n
        ? `You owe ${money(viewerPosition!.netMinor).replace(/^-/, '')}`
        : viewerNet > 0n
          ? `You're owed ${money(viewerNet.toString())}`
          : b.settled
            ? 'Settled'
            : 'Nothing to pay or collect. Other members still owe each other.';
  return (
    <section
      data-ui="group-balances form-region"
      className={cx(
        workspaceFeatureStyles['group-balances'],
        balanceStyles.view,
      )}
    >
      <BalanceHeading />
      <BalanceSummary
        currency={group.currency}
        positions={[
          b.positions.find((p) => p.member.id === group.viewerMembership.id)
            ?.netMinor,
        ]}
      />
      <BalanceSection
        scope={scope}
        identity={`group-${group.id}-source`}
        initiallyOpen
        summary={
          <SourceSummary
            name={group.isHousehold ? 'Household expenses' : group.name}
            icon={
              group.isHousehold
                ? 'home'
                : group.kind === 'TRIP'
                  ? 'trip'
                  : 'groups'
            }
            detail={sourceStatus}
          />
        }
      >
        <p>
          {b.positions.length} members · {group.currency}
        </p>
        {!b.obligations?.length && (
          <p>
            {b.settled
              ? 'No repayments are needed in this space.'
              : 'Repayment suggestions are unavailable; this space still has outstanding balances.'}
          </p>
        )}
        <ObligationRows
          scope={scope}
          space={group}
          viewer={group.viewerMembership.id}
          obligations={b.obligations ?? []}
          eligible={(id) =>
            group.members.some(
              (member) => member.id === id && member.canParticipate,
            )
          }
        />
        <BalanceSection
          scope={scope}
          identity={`group-${group.id}-positions`}
          summary={
            <h3>Each member’s balance · {b.positions.length} members</h3>
          }
        >
          <p>
            {b.settled
              ? 'Everyone in this space is settled: each member’s balance is zero.'
              : b.positions.find(
                    (p) => p.member.id === group.viewerMembership.id,
                  )?.netMinor === '0'
                ? 'Nothing to pay or collect. Other members still owe each other.'
                : 'This group has outstanding balances.'}
          </p>
          <div
            data-ui="workspace-member-balances"
            className={cx(
              overviewFeatureStyles['workspace-member-balances'],
              financialPaletteStyles['member-palette'],
            )}
          >
            {b.positions.map((p) => (
              <div
                data-ui="balance-position"
                className={workspaceFeatureStyles['balance-position']}
                key={p.member.id}
              >
                <details>
                  <summary
                    data-ui="balance-row"
                    className={financialStyles['balance-row']}
                  >
                    <Member
                      name={p.member.displayName}
                      detail={`${minor(p.netMinor) > 0n ? 'Is owed' : minor(p.netMinor) < 0n ? 'Owes' : 'Net zero'}${p.member.status === 'INACTIVE' ? ' · historical member' : ''}`}
                    />
                    <Money
                      value={money(p.netMinor).replace(/^-/, '')}
                      currency={group.currency}
                      focusable={false}
                    />
                    <span data-ui="row-detail">
                      Position details for {p.member.displayName}
                    </span>
                  </summary>
                  <dl
                    data-ui="balance-position-facts"
                    className={workspaceFeatureStyles['balance-position-facts']}
                  >
                    {[
                      ['Paid for expenses (+)', p.paidMinor],
                      ['Expense share (−)', p.owedMinor],
                      ['Repayments sent (+)', p.sentMinor],
                      ['Repayments received (−)', p.receivedMinor],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          <Money
                            value={money(value)}
                            currency={group.currency}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p
                    aria-label={`Balance calculation for ${p.member.displayName}`}
                  >
                    {money(p.paidMinor)} − {money(p.owedMinor)} +{' '}
                    {money(p.sentMinor)} − {money(p.receivedMinor)} ={' '}
                    {money(p.netMinor)} {group.currency}
                  </p>
                </details>
              </div>
            ))}
          </div>
        </BalanceSection>
        <Link href={`${spaceHref(group)}?tab=activity`}>
          View Activity and expense before/after history
        </Link>
        <GeneralRepaymentEntry scope={scope} group={group} />
        <RecentRepayments group={group} />
      </BalanceSection>
    </section>
  );
}
function GeneralRepaymentEntry({
  scope,
  group,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
}) {
  return (
    <ScopedLink
      scope={scope}
      id={`repay-general-${group.id}`}
      href={spaceRepaymentHref(group, new URLSearchParams())}
    >
      Record an actual transfer
    </ScopedLink>
  );
}
function RecentRepayments({ group }: { group: WorkspaceGroup }) {
  return (
    <section data-ui="form-region">
      <h3>Recent recorded repayments</h3>
      {!group.repayments ? (
        <p role="alert">Repayment history is unavailable.</p>
      ) : !group.repayments.edges.length ? (
        <p>No recorded repayments.</p>
      ) : (
        <ul>
          {group.repayments.edges.map(({ node }) => (
            <li key={node.id}>
              {node.sender.displayName} → {node.recipient.displayName} ·{' '}
              {money(node.amountMinor)} USD ·{' '}
              <time dateTime={node.effectiveDate}>
                {calendarDate(node.effectiveDate)}
              </time>
              {node.note && <p>{node.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
