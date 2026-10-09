import { AppIcon } from '@/components/workspace-identity';
import { Money } from '@/components/primitives';
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
export function eventAction(kind: HistoricalEvent['kind']) {
  return kind === 'EXPENSE_UPDATED'
    ? 'updated an expense'
    : kind === 'EXPENSE_CREATED'
      ? 'added an expense'
      : 'recorded a repayment';
}
function HistoricalValue({
  name,
  value,
  snapshot,
  currency,
}: {
  name: string;
  value: string;
  snapshot: Snapshot;
  currency: string;
}) {
  if (name === 'Amount')
    return <Money value={money(snapshot.totalMinor)} currency={currency} />;
  if (name === 'Participants')
    return (
      <ul className="activity-participants">
        {snapshot.allocations.map((allocation) => (
          <li key={allocation.participant.id}>
            <span>{allocation.participant.displayName}</span>
            <span>
              <Money
                value={money(allocation.amountMinor)}
                currency={currency}
              />
              {allocation.percentageHundredths == null
                ? ''
                : ` (${percentageText(allocation.percentageHundredths)}%)`}
            </span>
          </li>
        ))}
      </ul>
    );
  return value;
}
export function HistoricalDetail({ event }: { event: HistoricalEvent }) {
  const before = event.before ? rows(event.before) : undefined,
    after = event.after ? rows(event.after) : undefined;
  return (
    <>
      <header className="activity-record-heading">
        <span
          className={`activity-kind activity-kind-${event.kind.toLowerCase()}`}
        >
          <AppIcon
            name={
              event.kind === 'EXPENSE_UPDATED'
                ? 'edit'
                : event.kind === 'EXPENSE_CREATED'
                  ? 'expense'
                  : 'arrow-up-right'
            }
          />
        </span>
        <div>
          <h3>
            {event.description ||
              `Paid ${event.recipient?.displayName ?? 'recipient'}`}
          </h3>
          <p>{event.groupName}</p>
        </div>
      </header>
      <p
        className="activity-detail-amount"
        role="group"
        tabIndex={0}
        aria-label={`${money(event.amountMinor)} ${event.currency}`}
      >
        <Money value={money(event.amountMinor)} currency={event.currency} />
      </p>
      <p className="activity-detail-attribution">
        <span>
          {event.creator.displayName} {eventAction(event.kind)}
        </span>
        <time dateTime={event.timestamp}>
          Recorded {new Date(event.timestamp).toLocaleString()}
        </time>
      </p>
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
            // The heading and amount already show unchanged values. Retain full
            // previous/new rows whenever either value changed in this event.
            if (!changed && (key === 'Description' || key === 'Amount'))
              return null;
            return (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {changed ? (
                    <>
                      <div className="activity-previous">
                        <span className="activity-value-label">Previous</span>
                        <HistoricalValue
                          name={key}
                          value={before[key as keyof typeof before]}
                          snapshot={event.before!}
                          currency={event.currency}
                        />
                      </div>
                      <div className="activity-new">
                        <span className="activity-value-label">New</span>
                        <HistoricalValue
                          name={key}
                          value={value}
                          snapshot={event.after!}
                          currency={event.currency}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <HistoricalValue
                        name={key}
                        value={value}
                        snapshot={event.after!}
                        currency={event.currency}
                      />
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
            Date: event.effectiveDate,
            Sender: event.sender?.displayName ?? '',
            Recipient: event.recipient?.displayName ?? '',
            Note: event.note || 'No note',
          }).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="activity-event-help">
        {event.kind === 'REPAYMENT_RECORDED'
          ? 'This records an actual transfer between the sender and recipient. It changes their balances without changing expense spending. No money is moved by this app.'
          : 'These are the values recorded at this event. Later expense changes do not rewrite this history.'}
      </p>
    </>
  );
}
