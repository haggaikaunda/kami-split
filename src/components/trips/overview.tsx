'use client';
import type { Snapshot } from '@/lib/data/port';
import type { TripDetail } from '@/lib/trip-detail';
import { formatMoney } from '@/lib/ledger';
import { TripSpending } from '../spending/trip';
import { Button, Card, Member } from '../primitives';
export function TripOverview({
  snapshot,
  model,
  showExpenses,
}: {
  snapshot: Snapshot;
  model: TripDetail;
  showExpenses: () => void;
}) {
  const own = model.positions.find((row) => row.memberId === snapshot.actorId);
  return (
    <>
      <div className="trip-metrics">
        <Card title="Total trip spending">
          <p className="trip-metric ui-money">
            {formatMoney(model.total, model.currency)}
          </p>
          <p>
            {model.count} {model.count === 1 ? 'expense' : 'expenses'} · No
            repayments included
          </p>
        </Card>
        <Card title="Your allocated share">
          <p className="trip-metric ui-money">
            {formatMoney(own?.share ?? 0, model.currency)}
          </p>
          <p>
            {snapshot.members.find((member) => member.id === snapshot.actorId)
              ?.name ?? 'Your'}{' '}
            share of trip expenses
          </p>
        </Card>
      </div>
      <Card title="Who paid what">
        <ul className="trip-contributions">
          {model.positions.map((row) => {
            const member = snapshot.members.find(
              (item) => item.id === row.memberId,
            )!;
            return (
              <li key={row.memberId}>
                <Member name={member.name} />
                <dl>
                  <div>
                    <dt>Expenses paid</dt>
                    <dd className="ui-money">
                      {formatMoney(row.paid, model.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Allocated share</dt>
                    <dd className="ui-money">
                      {formatMoney(row.share, model.currency)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </Card>
      <TripSpending snapshot={snapshot} trip={model.trip} />
      <div className="ui-actions">
        <Button tone="secondary" onClick={showExpenses}>
          View daily expenses
        </Button>
        <Button tone="secondary" onClick={showExpenses}>
          Browse by category
        </Button>
      </div>
    </>
  );
}
