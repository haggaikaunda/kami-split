'use client';
import { useEffect, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import document, {
  type journeyExpenseQuery,
} from '@/lib/relay/__generated__/journeyExpenseQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { CategoryIcon } from '@/components/workspace-identity';
import { Member, Money } from '@/components/primitives';
import { money } from '@/lib/relay/money';
type Expense = Extract<
  NonNullable<journeyExpenseQuery['response']['node']>,
  { readonly __typename: 'Expense' }
>;
export function ExpenseDetail({
  scope,
  group,
  id,
  onUnavailable,
}: {
  scope: FinancialScope;
  group: string;
  id: string;
  onUnavailable?: () => void;
}) {
  const [expense, setExpense] = useState<Expense>();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const subscription = fetchQuery<journeyExpenseQuery>(
      scope.environment,
      document,
      { id },
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next(result) {
        if (!active || !scope.isLive()) return;
        // Do not render any fields until both canonical IDs match.
        if (
          result.node?.__typename === 'Expense' &&
          result.node.id === id &&
          result.node.groupId === group
        )
          setExpense(result.node);
        else {
          setFailed(true);
          onUnavailable?.();
        }
      },
      error() {
        if (active && scope.isLive()) {
          setFailed(true);
          onUnavailable?.();
        }
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // The owning list invalidates on failure; request identity owns the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, group, id, version]);
  if (failed)
    return (
      <>
        <p role="alert">
          Expense unavailable. No expense details can be shown.
        </p>
        <button
          onClick={() => {
            setFailed(false);
            setExpense(undefined);
            setVersion((v) => v + 1);
          }}
        >
          Retry expense
        </button>
      </>
    );
  if (!expense) return <p role="status">Loading authorized expense…</p>;
  return (
    <section className="expense-detail-card">
      <div className="expense-detail-identity">
        <CategoryIcon category={expense.category} />
        <div>
          <h2>{expense.description}</h2>
          <time dateTime={expense.effectiveDate}>{expense.effectiveDate}</time>
        </div>
      </div>
      <p className="expense-detail-total">
        <Money value={money(expense.totalMinor)} currency={expense.currency} />
      </p>
      <div className="expense-paid-by">
        <span>Paid by</span>
        <Member name={expense.payer.displayName} />
      </div>
      <dl className="expense-detail-fields">
        <div>
          <dt>Category</dt>
          <dd>
            {expense.category[0] + expense.category.slice(1).toLowerCase()}
          </dd>
        </div>
        <div>
          <dt>Participants</dt>
          <dd>
            <ul className="expense-allocation-list">
              {expense.allocations.map((share) => (
                <li key={share.participant.id}>
                  <Member name={share.participant.displayName} />
                  <Money
                    value={money(share.amountMinor)}
                    currency={expense.currency}
                  />
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Note</dt>
          <dd>{expense.note || 'No note added.'}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>
            {expense.creator.displayName}
            <time dateTime={expense.createdAt}>
              {expense.createdAt.replace('T', ' ').replace('Z', ' UTC')}
            </time>
          </dd>
        </div>
      </dl>
    </section>
  );
}
