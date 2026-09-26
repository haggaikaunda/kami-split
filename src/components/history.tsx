'use client';
import type { Activity, ExpenseRecord, Snapshot } from '../lib/data/port';
import {
  activityLabels,
  historyDate,
  historyDescription,
  historyEvents,
  historyMemberName,
} from '../lib/history';
import { formatMoney } from '../lib/ledger';
import { useAppData } from './data-provider';
import {
  Button,
  EmptyState,
  Field,
  SelectField,
  Skeleton,
  Status,
} from './primitives';
import { DraftLink, ExpenseLink, RepaymentLink } from './navigation/links';
import {
  useExpenseNavigation,
  useRouteContext,
  useRouteReady,
} from './navigation/provider';
import './history.css';
function EventRow({
  event,
  snapshot,
}: {
  event: Activity;
  snapshot: Snapshot;
}) {
  const title = historyDescription(event, snapshot);
  const row = event.snapshot;
  const repayment = event.kind === 'repayment';
  return (
    <li className="history-event">
      <div className="history-event-main">
        <span className={`history-kind history-kind--${event.kind}`}>
          {activityLabels[event.kind]}
        </span>
        {repayment ? (
          <RepaymentLink
            repaymentId={event.recordId}
            id={`history-event-${event.id}`}
          >
            {title}
          </RepaymentLink>
        ) : (
          <ExpenseLink
            expenseId={event.recordId}
            revision={(row as ExpenseRecord).version}
            id={`history-event-${event.id}`}
          >
            {title}
          </ExpenseLink>
        )}
        <p>
          Recorded by {historyMemberName(snapshot, event.actorId)} ·{' '}
          <time dateTime={event.at}>{historyDate(event.at, true)}</time>
        </p>
        <p>
          {repayment ? 'Repayment date' : 'Expense date'}:{' '}
          <time dateTime={row.effectiveDate}>
            {historyDate(row.effectiveDate)}
          </time>
          {!repayment && <> · Revision {(row as ExpenseRecord).version}</>}
        </p>
        {event.kind === 'deleted' && (
          <p>Removed from current balances and spending; history retained.</p>
        )}
      </div>
      <strong className="history-amount">
        {row.currency === 'USD' ? '$' : '€'}
        {formatMoney(row.amount, row.currency)}
      </strong>
    </li>
  );
}
export function History() {
  const { snapshot, status, readyVersion, refresh } = useAppData();
  const { searchParams, isActive } = useRouteContext('/history');
  const { replaceQuery } = useExpenseNavigation();
  useRouteReady('/history', readyVersion);
  const filters = {
    search: searchParams.get('search') ?? '',
    type: searchParams.get('type') ?? 'all',
    member: searchParams.get('member') ?? 'all',
  };
  const filtered =
    !!filters.search || filters.type !== 'all' || filters.member !== 'all';
  const readable =
    snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  const events = readable ? historyEvents(snapshot, filters) : [];
  function change(values: Partial<typeof filters>) {
    if (!isActive) return;
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    replaceQuery(`/history${next.size ? `?${next}` : ''}`);
  }
  const clear = () => change({ search: '', type: 'all', member: 'all' });
  const knownType = filters.type === 'all' || filters.type in activityLabels;
  const knownMember =
    filters.member === 'all' ||
    snapshot?.members.some((member) => member.id === filters.member);
  return (
    <section className="history-screen">
      <header className="history-heading">
        <div>
          <p className="overview-eyebrow">All accounted for</p>
          <h1 data-page-heading tabIndex={-1}>
            Your shared history.
          </h1>
          <p>Every expense, repayment, and change.</p>
        </div>
        <DraftLink draftId="new-expense" id="history-add-expense">
          Add expense
        </DraftLink>
      </header>
      <div className="history-filters" aria-label="History filters">
        <Field
          label="Search history"
          placeholder="Search descriptions…"
          value={filters.search}
          disabled={!isActive}
          onChange={(event) => change({ search: event.target.value })}
        />
        <SelectField
          label="Activity type"
          value={filters.type}
          disabled={!isActive}
          onChange={(event) => change({ type: event.target.value })}
        >
          <option value="all">All activity</option>
          <option value="created">Expenses</option>
          <option value="repayment">Repayments</option>
          <option value="edited">Edits</option>
          <option value="deleted">Deletions</option>
          {!knownType && (
            <option value={filters.type}>Unavailable activity filter</option>
          )}
        </SelectField>
        <SelectField
          label="Filter by member"
          value={filters.member}
          disabled={!isActive}
          onChange={(event) => change({ member: event.target.value })}
        >
          <option value="all">All members</option>
          {readable &&
            snapshot.members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
                {member.status === 'active' ? '' : ` (${member.status})`}
              </option>
            ))}
          {(!knownMember || !readable) && filters.member !== 'all' && (
            <option value={filters.member}>Selected member</option>
          )}
        </SelectField>
      </div>
      {filtered && (
        <Button tone="secondary" disabled={!isActive} onClick={clear}>
          Clear filters
        </Button>
      )}
      {status === 'loading' ? (
        <Skeleton label="Loading financial history" />
      ) : !readable ? (
        <Status kind={status === 'error' ? 'error' : 'denied'}>
          History could not be loaded. Your filters are retained; no financial
          records are shown.
          <Button tone="secondary" onClick={() => void refresh()}>
            Retry history
          </Button>
        </Status>
      ) : (
        <>
          {status !== 'ready' && (
            <Status kind="stale">
              {status === 'stale'
                ? 'Offline. Showing previously loaded history; it may be out of date.'
                : 'Refreshing history. Previously loaded events are shown.'}
              {status === 'stale' && (
                <Button tone="secondary" onClick={() => void refresh()}>
                  Retry history
                </Button>
              )}
            </Status>
          )}
          <p className="history-count" role="status">
            {events.length} {events.length === 1 ? 'event' : 'events'} · Newest
            first · All dates · {snapshot.household.currency}
          </p>
          {events.length ? (
            <ol className="history-list" aria-label="Financial activity">
              {events.map((event) => (
                <EventRow key={event.id} event={event} snapshot={snapshot} />
              ))}
            </ol>
          ) : snapshot.activity.length ? (
            <EmptyState title="No matching activity">
              Try another description, activity type, or member.
            </EmptyState>
          ) : (
            <EmptyState
              title="Start your shared history"
              action={
                <DraftLink draftId="new-expense" id="history-first-expense">
                  Add first expense
                </DraftLink>
              }
            >
              Add your first expense to begin tracking shared spending.
            </EmptyState>
          )}
        </>
      )}
    </section>
  );
}
