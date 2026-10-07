import { Fragment } from 'react';
import { CategoryIcon } from '@/components/workspace-identity';
import { Member } from '@/components/primitives';
import { money } from '@/lib/relay/money';
import { percentageText } from '@/lib/relay/percentage';
import type { activityDetailQuery } from '@/lib/relay/__generated__/activityDetailQuery.graphql';
export type HistoricalEvent = Extract<
  activityDetailQuery['response']['activityEvent'],
  { readonly __typename: 'ActivityEvent' }
>;
type Snapshot = NonNullable<HistoricalEvent['after']>;
function label(value: string) {
  return value[0] + value.slice(1).toLowerCase();
}
function shares(value: Snapshot) {
  return value.allocations
    .map(
      (a) =>
        `${a.participant.displayName}: ${money(a.amountMinor)}${a.percentageHundredths == null ? '' : ` (${percentageText(a.percentageHundredths)}%)`}`,
    )
    .join('; ');
}
function rows(value: Snapshot) {
  return {
    Description: value.description,
    Amount: money(value.totalMinor),
    Date: value.effectiveDate,
    Category: label(value.category),
    Payer: value.payer.displayName,
    Split: label(value.split),
    Participants: shares(value),
    Note: value.note || 'No note',
  };
}
function identities(value: Snapshot) {
  return value.allocations
    .map((a) => [a.participant.id, a.amountMinor, a.percentageHundredths])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
export function eventSummary(
  event: Pick<HistoricalEvent, 'kind' | 'before' | 'after'>,
) {
  if (event.before && event.after) {
    if (event.before.totalMinor !== event.after.totalMinor)
      return `Amount changed from ${money(event.before.totalMinor)} to ${money(event.after.totalMinor)}.`;
    const before = rows(event.before),
      after = rows(event.after);
    const changed = Object.keys(before).filter(
      (k) =>
        before[k as keyof typeof before] !== after[k as keyof typeof after],
    );
    return `${changed.length ? changed.join(', ') : 'Expense details'} changed.`;
  }
  return event.after
    ? `${label(event.after.split)} split · ${event.after.allocations.length} participants`
    : 'Recorded actual transfer';
}
export function eventDay(timestamp: string, now = new Date()) {
  const date = new Date(timestamp),
    today = new Date(now),
    yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
export function HistoricalDetail({ event }: { event: HistoricalEvent }) {
  const before = event.before ? rows(event.before) : undefined,
    after = event.after ? rows(event.after) : undefined;
  return (
    <>
      <header className="activity-detail-attribution">
        <Member name={event.creator.displayName} />
        <div>
          <strong>
            {event.kind === 'EXPENSE_UPDATED'
              ? 'updated an expense'
              : event.kind === 'EXPENSE_CREATED'
                ? 'added an expense'
                : 'recorded a repayment'}
          </strong>
          <time dateTime={event.timestamp}>
            {new Date(event.timestamp).toLocaleString()}
          </time>
        </div>
      </header>
      <section className="activity-fact-card">
        <header>
          {event.after && <CategoryIcon category={event.after.category} />}
          <div>
            <h3>
              {event.description ||
                `Paid ${event.recipient?.displayName ?? 'recipient'}`}
            </h3>
            <p>{event.groupName}</p>
          </div>
        </header>
        {after ? (
          <dl className="activity-facts">
            {Object.entries(after).map(([key, value]) => {
              const changed =
                before &&
                (before[key as keyof typeof before] !== value ||
                  (key === 'Payer' &&
                    event.before!.payer.id !== event.after!.payer.id) ||
                  (key === 'Participants' &&
                    JSON.stringify(identities(event.before!)) !==
                      JSON.stringify(identities(event.after!))));
              return (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {changed ? (
                      <>
                        <span className="activity-previous">
                          <span className="activity-value-label">Previous</span>
                          {before[key as keyof typeof before]}
                        </span>
                        <span className="activity-new">
                          <span className="activity-value-label">New</span>
                          {value}
                        </span>
                      </>
                    ) : (
                      <>
                        {value}
                        {before && <small> (unchanged)</small>}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <dl className="activity-facts">
            {Object.entries({
              Amount: `${money(event.amountMinor)} ${event.currency}`,
              Date: event.effectiveDate,
              Sender: event.sender?.displayName ?? '',
              Recipient: event.recipient?.displayName ?? '',
              Note: event.note || 'No note',
            }).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </section>
      <p className="activity-event-help">
        {event.kind === 'REPAYMENT_RECORDED'
          ? 'This records an actual transfer between the sender and recipient. It changes their balances without changing expense spending. No money is moved by this app.'
          : 'These are the values recorded at this event. Later expense changes do not rewrite this history.'}
      </p>
    </>
  );
}
