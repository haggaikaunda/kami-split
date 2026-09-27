'use client';
import type { Snapshot } from '@/lib/data/port';
import {
  bucketFromId,
  expenseScopeAmount,
  spendingBucket,
  type ChartScope,
} from '@/lib/spending-chart';
import { formatMoney } from '@/lib/ledger';
import { tripDateLabel } from '@/lib/trips';
import { useAppData } from '../data-provider';
import { ExpenseLink } from '../navigation/links';
import { Button, Dialog, EmptyState, Status } from '../primitives';
import { useSpendingNavigation } from './navigation';
export function SpendingDrilldown({
  snapshot,
  scope,
  route,
  tripId,
}: {
  snapshot: Snapshot;
  scope: ChartScope;
  route: string;
  tripId?: string;
}) {
  const { searchParams, isActive, close } = useSpendingNavigation(route);
  const { status } = useAppData();
  const selected = searchParams.get('bucket');
  const bucket = selected ? bucketFromId(selected) : undefined;
  const data = bucket
    ? spendingBucket(snapshot, bucket, scope, tripId)
    : undefined;
  return (
    <Dialog
      open={!!selected && isActive}
      title={
        bucket ? `${bucket.label} spending` : 'Spending bucket unavailable'
      }
      onClose={close}
    >
      {status !== 'ready' && (
        <Status kind="stale">
          Showing the last confirmed spending while current data is refreshing
          or unavailable.
        </Status>
      )}
      {data ? (
        <>
          <p>
            {scope === 'share'
              ? 'Your allocated share'
              : 'Household expense spending'}{' '}
            · {formatMoney(data.total, snapshot.household.currency)} ·{' '}
            {data.count} {data.count === 1 ? 'expense' : 'expenses'}
          </p>
          {data.count ? (
            <ul className="spending-records">
              {data.expenses.map((expense) => (
                <li key={expense.id}>
                  <ExpenseLink
                    expenseId={expense.id}
                    id={`spending-record-${expense.id}`}
                  >
                    <strong>{expense.description}</strong>
                    <span className="ui-money">
                      {formatMoney(
                        expenseScopeAmount(expense, scope, snapshot.actorId),
                        expense.currency,
                      )}
                    </span>
                  </ExpenseLink>
                  <p>
                    {tripDateLabel(expense.effectiveDate)} · {expense.category}{' '}
                    ·{' '}
                    {snapshot.members.find(
                      (member) => member.id === expense.payerId,
                    )?.name ?? 'Former member'}{' '}
                    paid
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No expenses in this bucket">
              This selected bucket remains open even if an edit or deletion
              moved its last expense. Choose another period after returning to
              the chart.
            </EmptyState>
          )}
        </>
      ) : (
        <Status kind="info">
          This bucket is not available. Return to the chart and select a valid
          period or category.
        </Status>
      )}
      <Button tone="secondary" onClick={close}>
        Back to chart
      </Button>
    </Dialog>
  );
}
