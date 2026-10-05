'use client';
import { CategoryIcon } from '@/components/workspace-identity';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { journeyGroupQuery } from '@/lib/relay/__generated__/journeyGroupQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { minor, money } from '@/lib/relay/money';
import { tripState } from '@/lib/relay/discovery';
import {
  Member,
  MemberBalanceRow,
  Money,
  RecommendedRepaymentRow,
  SignedBalanceMetric,
  SpaceChip,
  SummaryMetric,
  WorkspaceHeader,
  WorkspaceTabs,
  workspaceSections,
  type WorkspaceSection,
} from '@/components/primitives';
import { ScopedLink } from './navigation';
import { ActivityFeed } from '@/components/activity/feed';
import { ExpenseLedger } from '@/components/expenses/ledger';
import { RepaymentForm } from './repayment-form';
export type WorkspaceGroup = Extract<
  journeyGroupQuery['response']['group'],
  { readonly __typename: 'Group' }
>;
export function GroupWorkspace({
  scope,
  group,
  today,
  repayment = false,
  completed = false,
  onCommitted,
  onRefresh,
  onDenied,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
  today: string;
  repayment?: boolean;
  completed?: boolean;
  onRefresh: () => Promise<void>;
  onCommitted: () => Promise<void>;
  onDenied: () => void;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const requested = params.get('tab');
  const current: WorkspaceSection =
    workspaceSections.find((t) => t.toLowerCase() === requested) ??
    (params.has('after') ? 'Expenses' : 'Overview');
  const base = `/groups/${encodeURIComponent(group.id)}`;
  const hrefFor = (tab: WorkspaceSection) => `${base}?tab=${tab.toLowerCase()}`;
  const activeMembers = group.members.filter((m) => m.status === 'ACTIVE');
  return (
    <div
      className={`group-workspace-body ${group.trip ? 'group-workspace-body--trip' : ''}`}
    >
      {(!repayment || completed) && (
        <>
          <WorkspaceHeader
            title={group.name}
            appearance={
              group.trip ? 'trip' : group.isHousehold ? 'household' : 'group'
            }
            context={
              <>
                <SpaceChip>
                  {group.isHousehold
                    ? 'Household'
                    : group.trip
                      ? 'Trip'
                      : 'Group'}
                </SpaceChip>
                <span> · {group.currency}</span>
                {group.trip && (
                  <p>
                    {group.trip.destination} ·{' '}
                    <time dateTime={group.trip.startDate}>
                      {group.trip.startDate}
                    </time>{' '}
                    –{' '}
                    <time dateTime={group.trip.endDate}>
                      {group.trip.endDate}
                    </time>{' '}
                    · {tripState(group.trip, today)}
                  </p>
                )}
                <div className="group-members-context">
                  {activeMembers.slice(0, 3).map((m) => (
                    <Member key={m.id} name={m.displayName} />
                  ))}
                  <Link href={hrefFor('Members')}>
                    {activeMembers.length} active{' '}
                    {activeMembers.length === 1 ? 'member' : 'members'}
                  </Link>
                </div>
              </>
            }
          >
            {group.viewerMembership.role === 'OWNER' && (
              <div className="group-header-actions">
                <Link href="/invitations">Manage invitations</Link>
                <details className="group-settings">
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
          </WorkspaceHeader>
        </>
      )}
      <div
        onClick={(event) => {
          const a = (event.target as HTMLElement).closest('a');
          if (
            !a ||
            !a.closest('.ui-workspace-tabs') ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          router.push(a.getAttribute('href')!);
        }}
      >
        <WorkspaceTabs
          current={repayment ? 'Balances' : current}
          hrefFor={hrefFor}
          label={`${group.name} workspace`}
        />
      </div>
      {repayment && !completed ? (
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
        />
      ) : completed || current === 'Balances' ? (
        <GroupBalances scope={scope} group={group} />
      ) : current === 'Overview' ? (
        <>
          <OverviewMetrics scope={scope} group={group} />
          <section aria-labelledby="recent-expenses-title">
            <div className="group-section-heading">
              <h2 id="recent-expenses-title">Recent expenses</h2>
              <Link href={hrefFor('Expenses')}>View all expenses</Link>
            </div>
            <Expenses scope={scope} group={group} recent />
          </section>
        </>
      ) : current === 'Expenses' ? (
        <ExpenseLedger
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
          net={
            group.balances.__typename === 'GroupBalances'
              ? group.balances.positions.find(
                  (p) => p.member.id === group.viewerMembership.id,
                )?.netMinor
              : undefined
          }
          onDenied={onDenied}
          onRefreshContext={onRefresh}
        />
      ) : current === 'Members' ? (
        <section>
          <h2>Members</h2>
          {group.members.map((m) => (
            <MemberBalanceRow key={m.id} name={m.displayName}>
              <p>
                {m.role === 'OWNER' ? 'Owner' : 'Member'} ·{' '}
                {m.status === 'ACTIVE' ? 'Active' : 'Historical membership'}
              </p>
            </MemberBalanceRow>
          ))}
        </section>
      ) : (
        <section>
          <h2>Activity</h2>
          <ActivityFeed scope={scope} groupId={group.id} />
        </section>
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
    b.__typename === 'GroupBalances'
      ? b.positions.find((p) => p.member.id === group.viewerMembership.id)
      : undefined;
  if (!viewer)
    return (
      <SummaryMetric label="Your balance">
        <span role="alert">Balances are unavailable</span>
      </SummaryMetric>
    );
  const net = minor(viewer.netMinor),
    position = net > 0n ? 'positive' : net < 0n ? 'negative' : 'zero';
  return (
    <SignedBalanceMetric
      position={position}
      label="Your balance"
      value={`${net > 0n ? '+' : ''}${money(viewer.netMinor)}`}
      currency={group.currency}
      detail={
        <>
          <span aria-hidden="true">
            {net > 0n ? '↗ ' : net < 0n ? '↘ ' : '✓ '}
          </span>
          {net === 0n && b.__typename === 'GroupBalances' && !b.settled
            ? 'Your balance is zero. Other members still have open obligations.'
            : net > 0n
              ? "You're owed in this group."
              : net < 0n
                ? 'You owe in this group.'
                : 'Settled in this group.'}
          {disclosure && (
            <ScopedLink
              scope={scope}
              id="view-balance"
              href={`/groups/${encodeURIComponent(group.id)}?tab=balances`}
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
  return (
    <div className="ui-summary-row">
      <SummaryMetric label="Total expenses">
        {group.balances.__typename === 'GroupBalances' ? (
          <Money
            value={money(group.balances.totalExpenseMinor)}
            currency={group.currency}
          />
        ) : (
          <span role="alert">Expense total unavailable</span>
        )}
      </SummaryMetric>
      <ViewerMetric scope={scope} group={group} disclosure />
    </div>
  );
}
function Expenses({
  scope,
  group,
  recent = false,
}: {
  scope: FinancialScope;
  group: WorkspaceGroup;
  recent?: boolean;
}) {
  const page = group.expenses;
  if (!page)
    return (
      <p role="alert">
        The expense page failed to load. Restart the list; this does not mean
        there are no expenses.
      </p>
    );
  if (!page.edges.length)
    return (
      <p>
        {page.pageInfo.hasPreviousPage
          ? 'No expenses in this page.'
          : 'This group has no expenses.'}
      </p>
    );
  return (
    <ul className="group-expense-list">
      {(recent ? page.edges.slice(0, 5) : page.edges).map(
        (edge) =>
          edge && (
            <li key={edge.node.id}>
              <ScopedLink
                scope={scope}
                id={`expense-${edge.node.id}`}
                href={`/groups/${encodeURIComponent(group.id)}/expenses/${encodeURIComponent(edge.node.id)}`}
              >
                <CategoryIcon category={edge.node.category} />
                <span className="expense-row-copy">
                  <strong>{edge.node.description}</strong>
                  <span className="ui-row-detail">
                    <time dateTime={edge.node.effectiveDate}>
                      {edge.node.effectiveDate}
                    </time>{' '}
                    · {edge.node.category} · Paid by{' '}
                    {edge.node.payer.displayName}
                  </span>
                </span>
                <Money
                  value={money(edge.node.totalMinor)}
                  currency={group.currency}
                />
              </ScopedLink>
            </li>
          ),
      )}
    </ul>
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
  if (b.__typename !== 'GroupBalances')
    return (
      <section>
        <h2>Complete balances</h2>
        <p role="alert">
          Balances are unavailable. This group cannot be shown as settled.
        </p>
      </section>
    );
  return (
    <section className="group-balances">
      <h2>Balance details</h2>
      <ViewerMetric scope={scope} group={group} />
      <p>
        {b.settled
          ? 'Settled: every individual net is zero.'
          : 'This group has outstanding balances.'}{' '}
        Recording a repayment does not move money.
      </p>
      <h3>Member positions</h3>
      {b.positions.map((p) => (
        <MemberBalanceRow key={p.member.id} name={p.member.displayName}>
          <p>
            {minor(p.netMinor) > 0n
              ? 'Owed'
              : minor(p.netMinor) < 0n
                ? 'Owes'
                : 'Settled'}
            : {money(p.netMinor).replace(/^-/, '')} USD
            {p.member.status === 'INACTIVE' && ' · historical member'}
          </p>
          <p>
            Paid {money(p.paidMinor)} · Share {money(p.owedMinor)} · Sent{' '}
            {money(p.sentMinor)} · Received {money(p.receivedMinor)}
          </p>
        </MemberBalanceRow>
      ))}
      <h3>Current simplified obligations</h3>
      <p>
        Each row identifies the sender, recipient and amount within {group.name}
        . Original expenses are history, not additional debts.
      </p>
      {!b.obligations.length && <p>No current simplified obligations.</p>}
      {b.obligations.map((o) => {
        const eligible = [o.from.id, o.to.id].every((id) =>
          group.members.some((m) => m.id === id && m.canParticipate),
        );
        const query = new URLSearchParams({
          sender: o.from.id,
          recipient: o.to.id,
          amount: o.amountMinor,
        });
        return (
          <RecommendedRepaymentRow
            key={`${o.from.id}:${o.to.id}`}
            group={group.name}
            sender={
              o.from.id === group.viewerMembership.id
                ? `You (${o.from.displayName})`
                : o.from.displayName
            }
            recipient={
              o.to.id === group.viewerMembership.id
                ? `You (${o.to.displayName})`
                : o.to.displayName
            }
            value={money(o.amountMinor)}
            currency={group.currency}
            action={
              eligible ? (
                <ScopedLink
                  scope={scope}
                  id={`repay-${o.from.id}-${o.to.id}`}
                  href={`/groups/${encodeURIComponent(group.id)}/repayments/new?${query}`}
                >
                  Record {o.from.displayName} → {o.to.displayName} repayment
                </ScopedLink>
              ) : (
                <span>Recording requires two currently eligible members.</span>
              )
            }
          />
        );
      })}
      <RecentRepayments group={group} />
    </section>
  );
}
function RecentRepayments({ group }: { group: WorkspaceGroup }) {
  return (
    <section>
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
              <time dateTime={node.effectiveDate}>{node.effectiveDate}</time>
              {node.note && <p>{node.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
