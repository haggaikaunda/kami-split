'use client';
import { CommandFeedback } from '../command-feedback';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CATEGORIES } from '../../lib/data/mock';
import type { ExpenseInput, Snapshot } from '../../lib/data/port';
import {
  defaultExpenseDraft,
  decimalText,
  validateExpenseDraft,
  type ExpenseDraft,
} from '../../lib/expense-draft';
import { formatMoney } from '../../lib/ledger';
import { useAppData } from '../data-provider';
import { useExpenseNavigation, useSessionDraft } from '../navigation/provider';
import {
  Button,
  Confirmation,
  Dialog,
  ErrorSummary,
  Field,
  SelectField,
  Skeleton,
  Status,
} from '../primitives';
import { useExpenseCreation, type CreationState } from './controller';
import './form.css';

const addDraftId = 'new-expense';
const fieldId = (key: string) => `create-${encodeURIComponent(key)}`;
function suggestedTrip(
  snapshot: Snapshot,
  explicit: string | null,
  source?: string,
) {
  const path = source ? new URL(source, 'https://kami.invalid').pathname : '';
  const id =
    explicit ??
    (path.startsWith('/trips/')
      ? decodeURIComponent(path.slice('/trips/'.length))
      : undefined);
  return snapshot.trips.some((trip) => trip.id === id) ? id : undefined;
}
export function ExpenseForm<T extends ExpenseDraft>({
  snapshot,
  disabled,
  visit,
  initialFocusRef,
  draftId,
  initialValues,
  label,
  state,
  onSave,
  onRecover,
  saveLabel = 'Save expense',
  disabledMessage = 'The household is refreshing or offline. Your draft is preserved; restore current data before saving.',
  beforeFields,
  saveDisabled = false,
  onExit,
  introduction = 'Record a shared expense. Nothing is charged and no money is moved.',
  showTripSuggestion = true,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  visit: string | null;
  initialFocusRef: React.RefObject<HTMLInputElement | null>;
  draftId: string;
  initialValues: T;
  label: string;
  state?: CreationState;
  onSave: (value: ExpenseInput, operationId: string) => Promise<void>;
  onRecover: (operationId: string) => Promise<void>;
  saveLabel?: string;
  disabledMessage?: string;
  beforeFields?: React.ReactNode;
  saveDisabled?: boolean;
  onExit?: () => void;
  introduction?: string;
  showTripSuggestion?: boolean;
}) {
  useEffect(() => {
    initialFocusRef.current?.focus();
  }, [initialFocusRef]);
  const { returnToSource } = useExpenseNavigation();
  const { draft, update } = useSessionDraft<T>(draftId);
  const [defaults] = useState(initialValues);
  const values = draft?.values ?? defaults;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmEqual, setConfirmEqual] = useState(false);
  const locked = !!draft?.pending;
  const validation = validateExpenseDraft(values, snapshot);
  const errors = { ...validation.fields, ...(state?.fields ?? {}) };
  const show = (key: string) =>
    submitted || touched[key] ? errors[key] : undefined;
  const change = (next: Partial<ExpenseDraft>) => {
    if (!locked && !disabled) update({ ...values, ...next }, label);
  };
  const blur = (key: string) => () =>
    setTouched((previous) => ({ ...previous, [key]: true }));
  function switchMode(mode: 'equal' | 'exact') {
    if (mode === values.split) return;
    if (mode === 'equal') setConfirmEqual(true);
    else {
      const exact = { ...values.exact };
      validation.allocations.forEach((row) => {
        if (exact[row.memberId] === undefined)
          exact[row.memberId] = decimalText(row.amount);
      });
      values.participantIds.forEach((id) => {
        if (exact[id] === undefined) exact[id] = '0.00';
      });
      change({ split: 'exact', exact });
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked || disabled || saveDisabled) return;
    setSubmitted(true);
    if (!validation.value || !draft) {
      const first = Object.keys(validation.fields)[0];
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    await onSave(validation.value, draft.operationId);
  }
  const members = snapshot.members.filter(
    (member) =>
      member.status === 'active' ||
      values.participantIds.includes(member.id) ||
      values.payerId === member.id,
  );
  return (
    <>
      <p>{introduction}</p>
      {showTripSuggestion && values.tripId && (
        <p className="ui-hint">
          The suggested date is today within the trip dates. You can change it,
          including for pre-trip bookings.
        </p>
      )}
      {disabled && <Status kind="stale">{disabledMessage}</Status>}
      {beforeFields}
      <form noValidate onSubmit={submit}>
        {submitted && Object.keys(errors).length > 0 && (
          <ErrorSummary
            errors={Object.entries(errors).map(([key, message]) => ({
              fieldId: fieldId(key),
              message,
            }))}
          />
        )}
        <fieldset className="create-fields" disabled={locked || disabled}>
          <legend className="sr-only">Expense fields</legend>
          <div className="create-row">
            <Field
              ref={initialFocusRef}
              id={fieldId('amount')}
              label="Amount"
              inputMode="decimal"
              autoComplete="off"
              value={values.amount}
              onChange={(event) => change({ amount: event.target.value })}
              onBlur={blur('amount')}
              error={show('amount')}
              hint="USD · up to two decimal places"
            />
            <SelectField
              id={fieldId('currency')}
              label="Currency"
              value={values.currency}
              onChange={(event) => change({ currency: event.target.value })}
              error={show('currency')}
            >
              <option value="USD">USD</option>
            </SelectField>
          </div>
          <Field
            id={fieldId('description')}
            label="Description"
            value={values.description}
            onChange={(event) => change({ description: event.target.value })}
            onBlur={blur('description')}
            error={show('description')}
            maxLength={120}
          />
          <div className="create-row">
            <SelectField
              id={fieldId('payerId')}
              label="Paid by"
              value={values.payerId}
              onChange={(event) => change({ payerId: event.target.value })}
              onBlur={blur('payerId')}
              error={show('payerId')}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.status !== 'active' ? ' (inactive)' : ''}
                </option>
              ))}
            </SelectField>
            <Field
              id={fieldId('effectiveDate')}
              type="date"
              label="Expense date"
              value={values.effectiveDate}
              onChange={(event) =>
                change({ effectiveDate: event.target.value })
              }
              onBlur={blur('effectiveDate')}
              error={show('effectiveDate')}
            />
          </div>
          <div className="create-row">
            <SelectField
              id={fieldId('category')}
              label="Category"
              value={values.category}
              onChange={(event) => change({ category: event.target.value })}
              error={show('category')}
            >
              {CATEGORIES.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </SelectField>
            <SelectField
              id={fieldId('tripId')}
              label="Trip"
              value={values.tripId}
              onChange={(event) => change({ tripId: event.target.value })}
              error={show('tripId')}
            >
              <option value="">Everyday expense</option>
              {snapshot.trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </SelectField>
          </div>
          <fieldset
            id={fieldId('participantIds')}
            tabIndex={-1}
            aria-describedby={
              show('participantIds') ? 'create-participants-error' : undefined
            }
            aria-invalid={!!show('participantIds')}
            className="create-participants"
          >
            <legend>Included participants</legend>
            <p className="ui-hint">
              Payer and participants can differ. Included zero-share members
              remain participants.
            </p>
            {members.map((member) => (
              <label className="create-checkbox" key={member.id}>
                <input
                  type="checkbox"
                  checked={values.participantIds.includes(member.id)}
                  onChange={(event) =>
                    change({
                      participantIds: event.target.checked
                        ? [...values.participantIds, member.id]
                        : values.participantIds.filter(
                            (id) => id !== member.id,
                          ),
                    })
                  }
                />
                {member.name}
              </label>
            ))}
            {show('participantIds') && (
              <p className="ui-error" id="create-participants-error">
                {show('participantIds')}
              </p>
            )}
          </fieldset>
          <fieldset className="create-split">
            <legend>Split method</legend>
            {(['equal', 'exact'] as const).map((mode) => (
              <label className="create-checkbox" key={mode}>
                <input
                  type="radio"
                  name="split"
                  checked={values.split === mode}
                  onChange={() => switchMode(mode)}
                />
                {mode === 'equal' ? 'Equal' : 'Exact amounts'}
              </label>
            ))}
          </fieldset>
          {values.split === 'equal' ? (
            <>
              <p className="ui-hint">
                Remainder cents go to included member IDs in ascending order, so
                selection order never changes the extra cent.
              </p>
              <ul className="create-allocation-list">
                {validation.allocations.map((row) => (
                  <li key={row.memberId}>
                    {
                      snapshot.members.find(
                        (member) => member.id === row.memberId,
                      )?.name
                    }{' '}
                    <strong className="ui-money">
                      {formatMoney(row.amount, 'USD')}
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div>
              {values.participantIds.map((id) => (
                <Field
                  key={id}
                  id={fieldId(`allocation-${id}`)}
                  label={`${snapshot.members.find((member) => member.id === id)?.name ?? 'Member'} share (USD)`}
                  inputMode="decimal"
                  value={values.exact[id] ?? ''}
                  onChange={(event) =>
                    change({
                      exact: { ...values.exact, [id]: event.target.value },
                    })
                  }
                  onBlur={blur(`allocation-${id}`)}
                  error={show(`allocation-${id}`)}
                />
              ))}
              <p className="ui-hint">
                Exact amounts are retained if you temporarily exclude a
                participant or switch to Equal.
              </p>
            </div>
          )}
          <div
            id={fieldId('allocations')}
            tabIndex={-1}
            role="status"
            className="create-reconciliation"
          >
            {validation.remaining === undefined
              ? 'Enter the amount and all included shares to reconcile.'
              : validation.remaining === 0
                ? 'Fully allocated. Shares match the expense total.'
                : validation.remaining > 0
                  ? `${formatMoney(validation.remaining, 'USD')} remains to allocate.`
                  : `${formatMoney(-validation.remaining, 'USD')} over the expense total.`}
            {show('allocations') && (
              <p className="ui-error">{show('allocations')}</p>
            )}
          </div>
          <div className="ui-field">
            <label htmlFor={fieldId('note')}>Note (optional)</label>
            <textarea
              id={fieldId('note')}
              rows={3}
              maxLength={2000}
              value={values.note}
              onChange={(event) => change({ note: event.target.value })}
              onBlur={blur('note')}
              aria-invalid={!!show('note')}
              aria-describedby={show('note') ? 'create-note-error' : undefined}
            />
            {show('note') && (
              <p className="ui-error" id="create-note-error">
                {show('note')}
              </p>
            )}
          </div>
        </fieldset>
        <CommandFeedback
          state={state}
          onRecover={
            draft ? () => void onRecover(draft.operationId) : undefined
          }
          recoveryLabel="Check save status and retry safely"
        />
        <div className="ui-actions create-actions">
          <Button
            tone="secondary"
            onClick={onExit ?? (() => returnToSource(visit))}
          >
            {draft ? 'Leave and preserve draft' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            pending={state?.phase === 'submitting'}
            disabled={
              locked || disabled || saveDisabled || validation.remaining !== 0
            }
          >
            {saveLabel}
          </Button>
        </div>
      </form>
      <Confirmation
        open={confirmEqual}
        title="Use an equal split?"
        confirmLabel="Use equal split"
        onCancel={() => setConfirmEqual(false)}
        onConfirm={() => {
          change({ split: 'equal' });
          setConfirmEqual(false);
        }}
      >
        Equal shares will be used for this expense. Your exact amounts remain in
        the draft if you switch back.
      </Confirmation>
    </>
  );
}

function AddExpenseForm({
  snapshot,
  disabled,
  visit,
  initialFocusRef,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  visit: string | null;
  initialFocusRef: React.RefObject<HTMLInputElement | null>;
}) {
  const params = useSearchParams();
  const { getSource } = useExpenseNavigation();
  const { draft } = useSessionDraft<ExpenseDraft>(addDraftId);
  const creation = useExpenseCreation();
  const [defaults] = useState(() =>
    defaultExpenseDraft(
      snapshot,
      suggestedTrip(snapshot, params.get('trip'), getSource(visit)?.href),
    ),
  );
  return (
    <ExpenseForm
      snapshot={snapshot}
      disabled={disabled}
      visit={visit}
      initialFocusRef={initialFocusRef}
      draftId={addDraftId}
      initialValues={defaults}
      label="new expense"
      state={draft ? creation.states[draft.operationId] : undefined}
      onSave={(value, operationId) =>
        creation.submit(addDraftId, operationId, value, visit)
      }
      onRecover={creation.recover}
    />
  );
}

export function AddExpense() {
  const { snapshot, status, refresh } = useAppData();
  const { returnToSource } = useExpenseNavigation();
  const visit = useSearchParams().get('visit');
  const amount = useRef<HTMLInputElement>(null);
  const canRead =
    !!snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  return (
    <Dialog
      open
      title="Add expense"
      onClose={() => returnToSource(visit)}
      initialFocusRef={amount}
    >
      <div className="create-expense">
        {canRead ? (
          <AddExpenseForm
            snapshot={snapshot!}
            disabled={status !== 'ready'}
            visit={visit}
            initialFocusRef={amount}
          />
        ) : status === 'loading' ? (
          <Skeleton label="Loading expense form" />
        ) : (
          <Status kind="denied">
            This household is unavailable to the current session. Your draft is
            retained but no financial fields are shown.
            <div className="ui-actions">
              <Button onClick={() => void refresh()}>Try again</Button>
            </div>
          </Status>
        )}
      </div>
    </Dialog>
  );
}
