'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import document, {
  type journeyExpenseQuery,
} from '@/lib/relay/__generated__/journeyExpenseQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { CategoryIcon } from '@/components/workspace-identity';
import { Member, Money, Button } from '@/components/primitives';
import { percentageText } from '@/lib/relay/percentage';
import { money } from '@/lib/relay/money';
import { readEditDraft } from '@/lib/relay/edit-draft';
import { ExpenseEdit } from './expense-edit';
import membersDocument, {
  type expenseEditMembersQuery,
} from '@/lib/relay/__generated__/expenseEditMembersQuery.graphql';
import type { Member as ExpenseMember } from '@/lib/relay/draft';
type Expense = Extract<
  NonNullable<journeyExpenseQuery['response']['node']>,
  { readonly __typename: 'Expense' }
>;
export function ExpenseDetail({
  scope,
  group,
  id,
  onUnavailable,
  onCommitted,
}: {
  scope: FinancialScope;
  group: string;
  id: string;
  onUnavailable?: () => void;
  onCommitted?: () => Promise<void>;
}) {
  const [retainedAttempt] = useState(() => {
    try {
      return !!readEditDraft(scope.actor, group, id)?.attempt;
    } catch {
      return true;
    }
  });
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState<readonly ExpenseMember[]>();
  const [editError, setEditError] = useState('');
  const [saved, setSaved] = useState(false);
  const savedNotice = saved ? (
    <p role="status">
      Expense edit saved. Current expense data is being checked separately; an
      unavailable refresh does not undo the edit.
    </p>
  ) : null;
  const editTrigger = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    if (!editing) return;
    let live = true;
    const request = fetchQuery<expenseEditMembersQuery>(
      scope.environment,
      membersDocument,
      { groupId: group },
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next(result) {
        if (!live || !scope.isLive()) return;
        if (result.group.__typename === 'Group' && result.group.id === group)
          setMembers(result.group.members);
        else {
          setEditError('Current source access is unavailable.');
          onUnavailable?.();
        }
      },
      error() {
        if (live && scope.isLive())
          setEditError(
            'Current members are unavailable. Close editing and retry.',
          );
      },
    });
    return () => {
      live = false;
      request.unsubscribe();
    };
    // Source and session own this authorized read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, scope, group]);
  if (failed)
    return (
      <>
        {savedNotice}
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
  if (!expense)
    return (
      <>
        {savedNotice}
        <p role="status">Loading authorized expense…</p>
      </>
    );
  if (editing)
    return members ? (
      <ExpenseEdit
        scope={scope}
        expense={expense}
        members={members}
        onDenied={() => {
          setEditing(false);
          setFailed(true);
          onUnavailable?.();
        }}
        onCancel={() => {
          setEditing(false);
          requestAnimationFrame(() => editTrigger.current?.focus());
        }}
        onCommitted={async () => {
          setSaved(true);
          setEditing(false);
          setExpense(undefined);
          setVersion((v) => v + 1);
          await onCommitted?.();
        }}
      />
    ) : (
      <section>
        <p role={editError ? 'alert' : 'status'}>
          {editError || 'Loading current editing permissions…'}
        </p>
        <button onClick={() => setEditing(false)}>Back to expense</button>
      </section>
    );
  return (
    <section className="expense-detail-card">
      {savedNotice}
      <div className="expense-detail-identity">
        <CategoryIcon category={expense.category} />
        <div>
          <h2>{expense.description}</h2>
        </div>
      </div>
      <p className="expense-detail-total">
        <Money value={money(expense.totalMinor)} currency={expense.currency} />
      </p>
      <div className="expense-paid-by">
        <span>Paid by</span>
        <strong>{expense.payer.displayName}</strong>
      </div>
      {expense.canEdit || retainedAttempt ? (
        <Button
          tone="tonal"
          ref={editTrigger}
          onClick={() => {
            setMembers(undefined);
            setEditError('');
            setEditing(true);
          }}
        >
          {retainedAttempt ? 'Recover expense edit' : 'Edit expense'}
        </Button>
      ) : (
        <p className="expense-edit-lock">
          {expense.editLockReason === 'FORMER_MEMBER'
            ? 'This expense cannot be edited because it involves a member who has left the group.'
            : 'This expense is currently read-only because editing eligibility is unavailable.'}
        </p>
      )}
      {expense.split === 'PERCENTAGE' && (
        <p className="percentage-help">
          Saved percentages describe responsibility. Fractional cents were
          distributed by largest remainder, then ascending participant identity.
        </p>
      )}
      <dl className="expense-detail-fields">
        <div>
          <dt>Date</dt>
          <dd>
            <time dateTime={expense.effectiveDate}>
              {new Intl.DateTimeFormat('en', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${expense.effectiveDate}T00:00:00Z`))}
            </time>
          </dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>
            {expense.category[0] + expense.category.slice(1).toLowerCase()}
          </dd>
        </div>
        <div>
          <dt>Note</dt>
          <dd>{expense.note || 'No note added.'}</dd>
        </div>
      </dl>
      <section className="expense-detail-split">
        <h3>
          {expense.split === 'PERCENTAGE'
            ? 'Split by percentage'
            : expense.split === 'EXACT'
              ? 'Exact split'
              : 'Split equally'}
        </h3>{' '}
        <ul className="expense-allocation-list">
          {expense.allocations.map((share) => (
            <li key={share.participant.id}>
              <Member name={share.participant.displayName} />
              {expense.split === 'PERCENTAGE' &&
                share.percentageHundredths != null && (
                  <span className="percentage-saved">
                    {percentageText(share.percentageHundredths)}%
                  </span>
                )}
              <Money
                value={money(share.amountMinor)}
                currency={expense.currency}
              />
            </li>
          ))}
        </ul>
      </section>
      <p className="expense-detail-audit">
        Created by {expense.creator.displayName} ·{' '}
        <time dateTime={expense.createdAt}>
          {expense.createdAt.replace('T', ' ').replace('Z', ' UTC')}
        </time>
      </p>
    </section>
  );
}
