'use client';
import Link from 'next/link';
import { useState } from 'react';
import { checkedSum, formatMoney } from '@/lib/ledger';
import { overview } from '@/lib/overview';
import type {
  Activity,
  ExpenseRecord,
  RepaymentRecord,
  Snapshot,
} from '@/lib/data/port';
import { useAppData } from './data-provider';
import { DemoPanel } from './demo-controls';
import { DraftLink, ExpenseLink } from './navigation/links';
import {
  useExpenseNavigation,
  useRouteReady,
  useRouteContext,
} from './navigation/provider';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Member,
  Skeleton,
  Status,
} from './primitives';

const displayMoney = (amount: number, currency: 'USD' | 'EUR') =>
  `${amount < 0 ? '-' : ''}${currency === 'USD' ? '$' : '€'}${formatMoney(Math.abs(amount), currency)}`;
function memberName(snapshot: Snapshot, id: string) {
  return (
    snapshot.members.find((member) => member.id === id)?.name ?? 'Former member'
  );
}
function ActivityRow({
  event,
  snapshot,
}: {
  event: Activity;
  snapshot: Snapshot;
}) {
  const repayment = event.kind === 'repayment';
  const row = event.snapshot;
  const title = repayment
    ? `${memberName(snapshot, (row as RepaymentRecord).senderId)} repaid ${memberName(snapshot, (row as RepaymentRecord).recipientId)}`
    : (row as ExpenseRecord).description;
  const label = {
    created: 'Expense added',
    edited: 'Expense edited',
    deleted: 'Expense deleted',
    repayment: 'Repayment recorded',
  }[event.kind];
  return (
    <li className="overview-event">
      <div>
        <span className="overview-event-kind">{label}</span>
        {repayment ? (
          <strong>{title}</strong>
        ) : (
          <ExpenseLink
            expenseId={event.recordId}
            id={`overview-event-${event.id}`}
          >
            {title}
          </ExpenseLink>
        )}
        <span className="overview-event-meta">
          {memberName(snapshot, event.actorId)} ·{' '}
          <time dateTime={event.at}>
            {new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(event.at))}
          </time>
        </span>
      </div>
      <span className="ui-money">{displayMoney(row.amount, row.currency)}</span>
    </li>
  );
}
export function Overview() {
  const { isActive } = useRouteContext('/');
  return (
    <>
      <OverviewContent />
      <DemoPanel active={isActive} />
    </>
  );
}
function OverviewContent() {
  const { snapshot, status, failure, readyVersion, refresh } = useAppData();
  useRouteReady('/', readyVersion);
  const { isActive } = useRouteContext('/');
  const { openContext } = useExpenseNavigation();
  const [explain, setExplain] = useState(false);
  const heading = (
    <header className="overview-heading">
      <div>
        <p className="overview-eyebrow">
          {snapshot?.household.name ?? 'Our household'}
        </p>
        <h1 data-page-heading tabIndex={-1}>
          Good things, shared.
        </h1>
        <p>Everyday expenses. Memorable adventures. All in one place.</p>
      </div>
      {snapshot && (
        <div className="overview-actions">
          <Link
            className="ui-button ui-button--secondary"
            href="/repayments/new"
            id="overview-record-repayment"
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                event.button === 0
              ) {
                event.preventDefault();
                openContext('/repayments/new', 'overview-record-repayment');
              }
            }}
          >
            Record repayment
          </Link>
          <DraftLink id="overview-add-expense" draftId="new-expense">
            Add expense
          </DraftLink>
        </div>
      )}
    </header>
  );
  if (!snapshot)
    return (
      <>
        {heading}
        {status === 'loading' || status === 'refreshing' ? (
          <Skeleton label="Loading your household" />
        ) : (
          <Status
            kind={
              status === 'denied' ||
              status === 'expired' ||
              status === 'unavailable'
                ? 'denied'
                : 'error'
            }
          >
            {status === 'expired'
              ? 'This simulated session has expired.'
              : status === 'denied'
                ? 'This household is not available to the simulated actor.'
                : status === 'unavailable'
                  ? 'This household is unavailable.'
                  : failure === 'offline'
                    ? 'You are offline. No household data has loaded yet.'
                    : 'Household data could not be loaded.'}
            <div className="ui-actions">
              <Button tone="secondary" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          </Status>
        )}
      </>
    );
  const data = overview(snapshot);
  const current = status === 'ready';
  const one = data.obligations.length === 1 ? data.obligations[0] : null;
  const settled = data.obligations.length === 0;
  const pristine =
    snapshot.expenses.length === 0 && snapshot.repayments.length === 0;
  return (
    <>
      {heading}
      {status === 'refreshing' && (
        <Status kind="pending">
          Refreshing household data. Amounts below are the last available
          values.
        </Status>
      )}
      {status === 'stale' && (
        <Status kind="info">
          You are offline. Showing the last available household data.
          <div className="ui-actions">
            <Button tone="secondary" onClick={() => void refresh()}>
              Retry connection
            </Button>
          </div>
        </Status>
      )}
      <div className="overview-top">
        <section
          className="overview-balance ui-card ui-card--balance"
          aria-labelledby="balance-heading"
        >
          <p className="overview-eyebrow">
            Household balance · All time{!current && ' · Last available'}
          </p>
          <h2 id="balance-heading">
            {one
              ? `${memberName(snapshot, one.senderId)} owes ${memberName(snapshot, one.recipientId)}`
              : settled
                ? current
                  ? pristine
                    ? 'No shared expenses yet.'
                    : 'You’re all settled up.'
                  : 'No obligations in the last available data.'
                : 'Shared balances, by member'}
          </h2>
          {one && (
            <p className="overview-balance-amount ui-money">
              {displayMoney(one.amount, data.currency)}
            </p>
          )}
          {settled && !pristine && (
            <p>
              No outstanding direct obligations
              {current ? '.' : ' in this snapshot. Refresh to confirm.'}
            </p>
          )}
          {data.obligations.length > 1 && (
            <ul className="overview-obligations">
              {data.obligations.map((row) => (
                <li key={`${row.senderId}:${row.recipientId}`}>
                  {memberName(snapshot, row.senderId)} owes{' '}
                  {memberName(snapshot, row.recipientId)}{' '}
                  <strong className="ui-money">
                    {displayMoney(row.amount, row.currency)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
          <Button tone="secondary" onClick={() => setExplain(true)}>
            How this adds up
          </Button>
          <p className="overview-balance-note">
            Repayments are recorded here. No money is moved.
          </p>
        </section>
        <Card title="Who paid what">
          <p className="overview-muted">
            Expenses paid · All time · {data.currency}
          </p>
          <ul className="overview-contributions">
            {data.positions.map((position) => (
              <li key={position.memberId}>
                <Member
                  name={memberName(snapshot, position.memberId)}
                  detail="Expenses paid"
                />
                <strong className="ui-money">
                  {displayMoney(position.paid, data.currency)}
                </strong>
              </li>
            ))}
          </ul>
          <p className="overview-total">
            Total shared expenses{' '}
            <strong className="ui-money">
              {displayMoney(data.spending, data.currency)}
            </strong>
          </p>
          <p className="overview-muted">
            Repayments are excluded from these contributions.
          </p>
        </Card>
      </div>
      {snapshot.members.length > 2 && (
        <Card title="Member positions">
          <p>
            Positive positions are owed; negative positions owe. Direct
            obligations above are not simplified across members.
          </p>
          <ul className="overview-positions">
            {data.positions.map((position) => (
              <li key={position.memberId}>
                <span>{memberName(snapshot, position.memberId)}</span>
                <strong className="ui-money">
                  {displayMoney(position.net, data.currency)}
                </strong>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <section
        className="overview-chart-placeholder"
        aria-labelledby="spending-heading"
      >
        <h2 id="spending-heading">Spending over time</h2>
        <p>Expense charts will appear here in the next part of this preview.</p>
      </section>
      <section className="overview-recent" aria-labelledby="recent-heading">
        <div className="overview-section-heading">
          <h2 id="recent-heading">Recent activity</h2>
          <Link href="/history">View all activity</Link>
        </div>
        {data.recent.length ? (
          <ul className="overview-events">
            {data.recent.map((event) => (
              <ActivityRow key={event.id} event={event} snapshot={snapshot} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Your shared story starts here"
            action={
              <DraftLink id="overview-first-expense" draftId="new-expense">
                Add your first expense
              </DraftLink>
            }
          >
            There are no expenses or repayments yet.
          </EmptyState>
        )}
      </section>
      <Dialog
        open={explain && isActive}
        title="How this adds up"
        onClose={() => setExplain(false)}
      >
        {!current && (
          <Status kind={status === 'stale' ? 'info' : 'pending'}>
            These are the last available values. Refresh to confirm the current
            balance.
          </Status>
        )}
        <p>
          For each member: allocated share − expenses paid − repayments sent +
          repayments received = amount owed. A negative result means that member
          is owed.
        </p>
        {data.positions.map((position) => (
          <section key={position.memberId} className="overview-explanation">
            <h3>{memberName(snapshot, position.memberId)}</h3>
            <dl>
              <div>
                <dt>Allocated share</dt>
                <dd>{displayMoney(position.share, data.currency)}</dd>
              </div>
              <div>
                <dt>Minus expenses paid</dt>
                <dd>{displayMoney(position.paid, data.currency)}</dd>
              </div>
              <div>
                <dt>Minus repayments sent</dt>
                <dd>{displayMoney(position.sent, data.currency)}</dd>
              </div>
              <div>
                <dt>Plus repayments received</dt>
                <dd>{displayMoney(position.received, data.currency)}</dd>
              </div>
              <div>
                <dt>Amount owed</dt>
                <dd>
                  {displayMoney(
                    checkedSum([
                      position.share,
                      -position.paid,
                      -position.sent,
                      position.received,
                    ]),
                    data.currency,
                  )}
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </Dialog>
    </>
  );
}
