'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMoney } from '../lib/ledger';
import type { ExpenseRecord, Snapshot } from '../lib/data/port';
import { Status } from './primitives';

const categorySymbols: Record<string, string> = {
  Dining: '🍽',
  Groceries: '🥬',
  Accommodation: '⌂',
  Transport: '↗',
  Activities: '☀',
  Home: '⌂',
  Other: '•',
};

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : value;
}

function timestampLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'long',
        timeZone: 'UTC',
      }).format(date)
    : value;
}

/** Complete values are rendered from the selected immutable record snapshot. */
export function ExpenseValues({
  record,
  snapshot,
}: {
  record: ExpenseRecord;
  snapshot: Snapshot;
}) {
  const member = (id: string) =>
    snapshot.members.find((row) => row.id === id)?.name ?? 'Unknown member';
  const trip = snapshot.trips.find((row) => row.id === record.tripId);
  return (
    <div className="expense-values">
      <p className="expense-total">
        ${formatMoney(record.amount, record.currency)}
      </p>
      <dl className="expense-facts">
        <div>
          <dt>Description</dt>
          <dd>{record.description}</dd>
        </div>
        <div>
          <dt>Expense date</dt>
          <dd>
            <time dateTime={record.effectiveDate}>
              {dateLabel(record.effectiveDate)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Paid by</dt>
          <dd>{member(record.payerId)}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{record.category}</dd>
        </div>
        <div>
          <dt>Trip</dt>
          <dd>
            {trip ? (
              <Link href={`/trips/${encodeURIComponent(trip.id)}`}>
                {trip.name}
              </Link>
            ) : record.tripId ? (
              'Unavailable trip'
            ) : (
              'Everyday expense'
            )}
          </dd>
        </div>
        <div>
          <dt>Split method</dt>
          <dd>{record.split === 'equal' ? 'Equal' : 'Exact amounts'}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{member(record.creatorId)}</dd>
        </div>
        <div>
          <dt>Created at</dt>
          <dd>
            <time dateTime={record.createdAt}>
              {timestampLabel(record.createdAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Updated at</dt>
          <dd>
            <time dateTime={record.updatedAt}>
              {timestampLabel(record.updatedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{record.version}</dd>
        </div>
        <div>
          <dt>Note</dt>
          <dd className="expense-note">{record.note || 'No note'}</dd>
        </div>
      </dl>
      <h3>Participant allocations</h3>
      <ul className="expense-allocations">
        {record.participantIds.map((id) => (
          <li key={id}>
            <span>
              {member(id)} <small>Included participant</small>
            </span>
            <strong>
              $
              {formatMoney(
                record.allocations.find((row) => row.memberId === id)!.amount,
                record.currency,
              )}
            </strong>
          </li>
        ))}
      </ul>
      <p>
        Allocations total ${formatMoney(record.amount, record.currency)}.{' '}
        {record.participantIds.includes(record.payerId)
          ? ''
          : `${member(record.payerId)} paid but is not a participant.`}
      </p>
    </div>
  );
}

export function ExpenseRecordView({
  record,
  snapshot,
  selectedRevision,
  renderActions,
}: {
  record: ExpenseRecord;
  snapshot: Snapshot;
  selectedRevision?: string | null;
  renderActions?: (record: ExpenseRecord) => ReactNode;
}) {
  const revisions = snapshot.revisions
    .filter((row) => row.expenseId === record.id)
    .sort((a, b) => b.version - a.version);
  const selected = selectedRevision
    ? revisions.find((row) => String(row.version) === selectedRevision)
    : undefined;
  return (
    <>
      <p className="expense-eyebrow">
        <span aria-hidden="true">
          {categorySymbols[record.category] ?? '•'}
        </span>{' '}
        {record.category} ·{' '}
        {record.deleted ? 'Deleted expense' : 'Current expense'}
      </p>
      <h1 id="expense-heading" data-page-heading tabIndex={-1}>
        {record.description}
      </h1>
      {record.deleted && (
        <Status kind="info">
          This expense was deleted. It no longer contributes to balances or
          spending. Its history is retained below.
        </Status>
      )}
      {selectedRevision && (
        <Status kind={selected ? 'info' : 'error'}>
          {selected
            ? `Selected activity: revision ${selected.version}. Current record is ${record.deleted ? 'deleted' : `revision ${record.version}`}.`
            : 'The requested revision is unavailable. The current record is shown below.'}
        </Status>
      )}
      <ExpenseValues record={record} snapshot={snapshot} />
      {!record.deleted && renderActions?.(record)}
      <section
        aria-label="Expense revision history"
        className="expense-revisions"
      >
        <h2>Revision history</h2>
        <p>
          Changes are recorded separately from the expense date. Each revision
          below preserves its complete values.
        </p>
        {!revisions.length && <p>No revision history is available.</p>}
        {revisions.map((revision) => (
          <details
            key={`${revision.id}-${selectedRevision ?? ''}`}
            open={selected?.id === revision.id || undefined}
            className={
              selected?.id === revision.id ? 'selected-revision' : undefined
            }
          >
            <summary>
              Revision {revision.version}
              {revision.snapshot.deleted
                ? ' · Deleted'
                : revision.version === 1
                  ? ' · Created'
                  : ' · Edited'}
              {selected?.id === revision.id ? ' · Selected activity' : ''}
            </summary>
            <p>
              By{' '}
              {snapshot.members.find((member) => member.id === revision.actorId)
                ?.name ?? 'Unknown member'}{' '}
              ·{' '}
              <time dateTime={revision.at}>{timestampLabel(revision.at)}</time>
            </p>
            <p>Reason: {revision.reason || 'No reason provided'}</p>
            <ExpenseValues record={revision.snapshot} snapshot={snapshot} />
          </details>
        ))}
      </section>
    </>
  );
}
