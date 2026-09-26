'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ExpenseRecord, Snapshot } from '../../lib/data/port';
import {
  expenseEditDraft,
  type ExpenseEditDraft,
} from '../../lib/expense-edit';
import {
  validateExpenseDraft,
  type ExpenseDraft,
} from '../../lib/expense-draft';
import { formatMoney } from '../../lib/ledger';
import { useAppData } from '../data-provider';
import { ExpenseForm } from '../expense-create/form';
import { useExpenseNavigation, useSessionDraft } from '../navigation/provider';
import { DraftLink } from '../navigation/links';
import { useSessionCommand } from '../session-command';
import { Button, Dialog, Skeleton, Status } from '../primitives';
import './form.css';

export function ExpenseEditAction({ record }: { record: ExpenseRecord }) {
  return record.deleted ? null : (
    <DraftLink
      draftId={`edit-expense-${record.id}`}
      id={`edit-expense-${record.id}`}
    >
      Edit expense
    </DraftLink>
  );
}
function ComparedValues({
  label,
  value,
  snapshot,
}: {
  label: string;
  value: ExpenseDraft;
  snapshot: Snapshot;
}) {
  const member = (id: string) =>
    snapshot.members.find((row) => row.id === id)?.name ?? 'Unavailable member';
  const allocations = validateExpenseDraft(value, snapshot).allocations;
  const rows = [
    ['Amount', `${value.amount || 'Not entered'} ${value.currency}`],
    ['Description', value.description || 'Not entered'],
    ['Paid by', member(value.payerId)],
    ['Expense date', value.effectiveDate || 'Not entered'],
    ['Category', value.category],
    [
      'Trip',
      snapshot.trips.find((row) => row.id === value.tripId)?.name ??
        (value.tripId ? 'Unavailable trip' : 'Everyday expense'),
    ],
    ['Split method', value.split === 'equal' ? 'Equal' : 'Exact amounts'],
    ['Note', value.note || 'No note'],
  ];
  return (
    <section className="edit-comparison-values" aria-label={label}>
      <h3>{label}</h3>
      <dl>
        {rows.map(([name, text]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <h4>Included participants and shares</h4>
      <ul>
        {value.participantIds.map((id) => (
          <li key={id}>
            {member(id)}:{' '}
            {value.split === 'exact'
              ? `${value.exact[id] || 'Not entered'} ${value.currency}`
              : allocations.find((row) => row.memberId === id)
                ? formatMoney(
                    allocations.find((row) => row.memberId === id)!.amount,
                    'USD',
                  )
                : 'Not calculated'}
          </li>
        ))}
      </ul>
      {!value.participantIds.length && <p>No included participants.</p>}
    </section>
  );
}
function EditingForm({
  record,
  snapshot,
  disabled,
  visit,
  focus,
  close,
}: {
  record: ExpenseRecord;
  snapshot: Snapshot;
  disabled: boolean;
  visit: string | null;
  focus: React.RefObject<HTMLInputElement | null>;
  close: () => void;
}) {
  const draftId = `edit-expense-${record.id}`;
  const { draft, update } = useSessionDraft<ExpenseEditDraft>(draftId);
  const [initial] = useState(() => expenseEditDraft(record));
  const values = draft?.values ?? initial;
  const commands = useSessionCommand();
  const state = draft ? commands.states[draft.operationId] : undefined;
  const conflict =
    state?.result?.status === 'conflict' &&
    state.result.current.version !== values.expectedVersion
      ? state.result.current
      : undefined;
  const deleted = record.deleted || state?.result?.status === 'deleted';
  const original = JSON.parse(values.original) as ExpenseRecord;
  const comparisonHeading = useRef<HTMLHeadingElement>(null);
  const lastConflict = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (disabled) return;
    if (conflict) comparisonHeading.current?.focus();
    else if (lastConflict.current !== undefined) focus.current?.focus();
    lastConflict.current = conflict?.version;
  }, [conflict?.version, disabled, focus, conflict]);
  const comparison = conflict ? (
    <section className="edit-conflict" aria-label="Compare expense changes">
      <h2 ref={comparisonHeading} tabIndex={-1}>
        Review conflicting changes
      </h2>
      <Status kind="error">
        Another member changed this expense. Your draft has not been saved.
        Compare the full values before choosing to reapply it.
      </Status>
      <div className="edit-comparison">
        <ComparedValues
          label={`Original · revision ${original.version}`}
          value={expenseEditDraft(original)}
          snapshot={snapshot}
        />
        <ComparedValues
          label={`Latest · revision ${conflict.version}`}
          value={expenseEditDraft(conflict)}
          snapshot={snapshot}
        />
        <ComparedValues
          label="Your unsaved draft"
          value={values}
          snapshot={snapshot}
        />
      </div>
      <p>
        Reapplying keeps all your draft fields and targets the latest revision.
        Saving will replace its values, including changes shown above.
      </p>
      <Button
        disabled={disabled}
        onClick={() =>
          update(
            { ...values, expectedVersion: conflict.version },
            `edit ${original.description}`,
          )
        }
      >
        Reapply my draft to revision {conflict.version}
      </Button>
    </section>
  ) : (
    <p className="ui-hint">
      Editing revision {values.expectedVersion}. A successful save records a new
      revision and preserves the creator and earlier history.
    </p>
  );
  return (
    <ExpenseForm
      snapshot={snapshot}
      disabled={disabled || !!deleted}
      visit={visit}
      initialFocusRef={focus}
      draftId={draftId}
      initialValues={initial}
      label={`edit ${original.description}`}
      saveLabel="Save changes"
      introduction="Correct the full expense below. Nothing is charged and earlier revisions remain available."
      showTripSuggestion={false}
      disabledMessage={
        deleted
          ? 'This expense was deleted. Your draft is retained for reference, but it cannot overwrite or restore the deleted expense.'
          : undefined
      }
      beforeFields={comparison}
      saveDisabled={!!conflict}
      state={
        state?.result?.status === 'conflict' ||
        state?.result?.status === 'deleted'
          ? undefined
          : state
      }
      onExit={close}
      onRecover={commands.recover}
      onSave={(value, operationId) =>
        commands.submit(
          draftId,
          operationId,
          {
            kind: 'update-expense',
            id: record.id,
            expectedVersion: values.expectedVersion,
            value,
          },
          visit,
        )
      }
    />
  );
}
export function EditExpense({ expenseId }: { expenseId: string }) {
  const { snapshot, status, refresh } = useAppData();
  const { returnToSource } = useExpenseNavigation();
  const visit = useSearchParams().get('visit');
  const focus = useRef<HTMLInputElement>(null);
  const close = () =>
    returnToSource(visit, `/expenses/${encodeURIComponent(expenseId)}`);
  const canRead = snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  const record = canRead
    ? snapshot.expenses.find((row) => row.id === expenseId)
    : undefined;
  return (
    <Dialog open title="Edit expense" initialFocusRef={focus} onClose={close}>
      <div className="create-expense">
        {record && snapshot ? (
          <EditingForm
            key={expenseId}
            record={record}
            snapshot={snapshot}
            disabled={status !== 'ready'}
            visit={visit}
            focus={focus}
            close={close}
          />
        ) : status === 'loading' ? (
          <Skeleton label="Loading expense to edit" />
        ) : (
          <Status kind="denied">
            This expense is unavailable. No financial fields are shown; any
            session draft is retained.
            <div className="ui-actions">
              <Button onClick={() => void refresh()}>Try again</Button>
              <Button tone="secondary" onClick={close}>
                Back to expense
              </Button>
            </div>
          </Status>
        )}
      </div>
    </Dialog>
  );
}
