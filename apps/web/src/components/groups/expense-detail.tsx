'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useFragment } from 'react-relay';
import { NetworkQuery } from '@/lib/relay/query';
import document, {
  type journeyExpenseQuery,
} from '@/lib/relay/__generated__/journeyExpenseQuery.graphql';
import fragment, {
  type expenseDetailExpense$key,
} from '@/lib/relay/__generated__/expenseDetailExpense.graphql';
import membersDocument, {
  type expenseEditMembersQuery,
} from '@/lib/relay/__generated__/expenseEditMembersQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { calendarDate } from '@/lib/dates';
import { Timestamp, ExactTimestamp } from '@/components/date-time';
import { overviewDate } from './overview-date';
import { AppIcon, CategoryIcon } from '@/components/workspace-identity';
import { Member, Button } from '../ui/primitives';
import { Money } from '../financial/presentation';
import { percentageText } from '@/lib/relay/percentage';
import { money } from '@/lib/relay/money';
import { readEditDraft } from '@/lib/relay/edit-draft';
import { ExpenseEdit } from './expense-edit';
type Props = {
  scope: FinancialScope;
  group: string;
  id: string;
  onUnavailable?: () => void;
  onCommitted?: () => Promise<void>;
};
export function ExpenseDetail(props: Props) {
  const { scope, group, id, onUnavailable } = props;
  const [retainedAttempt] = useState(() => {
    try {
      return !!readEditDraft(scope.actor, group, id)?.attempt;
    } catch {
      return true;
    }
  });
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(false);
  const retry = () => setVersion((v) => v + 1);
  const unavailable = (
    <ExpenseUnavailable retry={retry} onUnavailable={onUnavailable} />
  );
  return (
    <>
      {saved && (
        <p role="status">
          Expense edit saved. Current expense data is being checked separately;
          an unavailable refresh does not undo the edit.
        </p>
      )}
      <NetworkQuery<journeyExpenseQuery>
        scope={scope}
        key={version}
        document={document}
        variables={{ id }}
        fallback={<p role="status">Loading authorized expense…</p>}
        failure={unavailable}
      >
        {(result) =>
          result.node?.__typename === 'Expense' &&
          result.node.id === id &&
          result.node.groupId === group &&
          result.node.expense ? (
            <ExpenseDetailContent
              {...props}
              reference={result.node.expense}
              onRetry={retry}
              retainedAttempt={retainedAttempt}
              onCommitted={async () => {
                setSaved(true);
                retry();
                await props.onCommitted?.();
              }}
            />
          ) : (
            unavailable
          )
        }
      </NetworkQuery>
    </>
  );
}
function ExpenseUnavailable({
  retry,
  onUnavailable,
}: {
  retry: () => void;
  onUnavailable?: () => void;
}) {
  const unavailable = useEffectEvent(() => onUnavailable?.());
  useEffect(() => {
    unavailable();
  }, []);
  return (
    <>
      <p role="alert">Expense unavailable. No expense details can be shown.</p>
      <button onClick={retry}>Retry expense</button>
    </>
  );
}
function ExpenseDetailContent({
  scope,
  group,
  reference,
  retainedAttempt,
  onUnavailable,
  onCommitted,
  onRetry,
}: Props & {
  reference: expenseDetailExpense$key;
  retainedAttempt: boolean;
  onRetry: () => void;
}) {
  const expense = useFragment(fragment, reference);
  const [editing, setEditing] = useState(false);
  const [denied, setDenied] = useState(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editTrigger.current?.focus());
  };
  if (denied)
    return <ExpenseUnavailable retry={onRetry} onUnavailable={onUnavailable} />;
  if (editing)
    return (
      <NetworkQuery<expenseEditMembersQuery>
        scope={scope}
        document={membersDocument}
        variables={{ groupId: group }}
        fallback={
          <section>
            <p role="status">Loading current editing permissions…</p>
            <button onClick={() => setEditing(false)}>Back to expense</button>
          </section>
        }
        failure={
          <section>
            <p role="alert">
              Current members are unavailable. Close editing and retry.
            </p>
            <button onClick={() => setEditing(false)}>Back to expense</button>
          </section>
        }
      >
        {(result) =>
          result.group.__typename === 'Group' && result.group.id === group ? (
            <ExpenseEdit
              scope={scope}
              expense={expense}
              members={result.group.members}
              onDenied={() => {
                setDenied(true);
              }}
              onCancel={close}
              onCommitted={onCommitted ?? (async () => {})}
            />
          ) : (
            <EditUnavailable
              onUnavailable={onUnavailable}
              onBack={() => setEditing(false)}
            />
          )
        }
      </NetworkQuery>
    );
  return (
    <section className="expense-detail-card">
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
        {expense.payer.displayName} paid ·{' '}
        <time dateTime={expense.effectiveDate}>
          {overviewDate(expense.effectiveDate)}
        </time>
      </div>
      {expense.canEdit || retainedAttempt ? (
        <Button
          tone="tonal"
          ref={editTrigger}
          onClick={() => {
            setEditing(true);
          }}
        >
          <AppIcon name="edit" />
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
              {calendarDate(expense.effectiveDate)}
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
        <Timestamp value={expense.createdAt} />
      </p>
      <ExactTimestamp value={expense.createdAt} />
    </section>
  );
}

function EditUnavailable({
  onUnavailable,
  onBack,
}: {
  onUnavailable?: () => void;
  onBack: () => void;
}) {
  const unavailable = useEffectEvent(() => onUnavailable?.());
  useEffect(() => {
    unavailable();
  }, []);
  return (
    <section>
      <p role="alert">Current source access is unavailable.</p>
      <button onClick={onBack}>Back to expense</button>
    </section>
  );
}
