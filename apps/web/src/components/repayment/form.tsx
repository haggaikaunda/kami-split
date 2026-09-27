'use client';
import { CommandFeedback } from '../command-feedback';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Snapshot } from '@/lib/data/port';
import { formatMoney } from '@/lib/ledger';
import {
  repaymentDefaults,
  validateRepaymentDraft,
  type RepaymentDraft,
} from '@/lib/repayment-draft';
import { useAppData } from '../data-provider';
import { useExpenseNavigation, useSessionDraft } from '../navigation/provider';
import {
  Button,
  Dialog,
  ErrorSummary,
  Field,
  SelectField,
  Skeleton,
  Status,
} from '../primitives';
import { useRepaymentCreation } from './controller';
import './repayment.css';
const draftId = 'new-repayment';
const fieldId = (name: string) => `repayment-${name}`;
export function balanceSentence(
  snapshot: Snapshot,
  sender: string,
  recipient: string,
  amount: number,
) {
  if (amount === 0) return 'Settled between these members.';
  const name = (id: string) =>
    snapshot.members.find((member) => member.id === id)?.name ??
    'Unavailable member';
  return `${name(amount > 0 ? sender : recipient)} owes ${name(amount > 0 ? recipient : sender)} ${formatMoney(Math.abs(amount), snapshot.household.currency)}.`;
}
function RepaymentFields({
  snapshot,
  disabled,
  visit,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  visit: string | null;
}) {
  const { draft, update } = useSessionDraft<RepaymentDraft>(draftId);
  const { returnToSource } = useExpenseNavigation();
  const creation = useRepaymentCreation();
  const [defaults] = useState(() => repaymentDefaults(snapshot));
  const [submitted, setSubmitted] = useState(false);
  const values = draft?.values ?? defaults;
  const submitDefaults = useRef(false);
  const result = validateRepaymentDraft(values, snapshot);
  const state = draft && creation.states[draft.operationId];
  const locked = !!draft?.pending;
  const errors = { ...result.fields, ...(state?.fields ?? {}) };
  const change = (next: Partial<RepaymentDraft>) => {
    if (!locked && !disabled)
      update({ ...values, acknowledged: false, ...next }, 'repayment');
  };
  useEffect(() => {
    if (submitDefaults.current && draft && result.value && !disabled) {
      submitDefaults.current = false;
      void creation.submit(draftId, draft.operationId, result.value, visit);
    }
  }, [draft, result.value, disabled, creation, visit]);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (locked || disabled || !result.value) return;
        if (draft)
          void creation.submit(draftId, draft.operationId, result.value, visit);
        else {
          submitDefaults.current = true;
          update(values, 'repayment');
        }
      }}
    >
      <p>This records a repayment. No money is moved.</p>
      <p>
        Record money already repaid between household members. Repayments are
        not assigned to trips.
      </p>
      {disabled && (
        <Status kind="stale">
          Current household data is unavailable. Your draft is retained; refresh
          before saving.
        </Status>
      )}
      {submitted && Object.keys(errors).length > 0 && (
        <ErrorSummary
          errors={Object.entries(errors).map(([key, message]) => ({
            fieldId: fieldId(key),
            message,
          }))}
        />
      )}
      <fieldset className="repayment-fields" disabled={locked || disabled}>
        <legend className="sr-only">Repayment fields</legend>
        <div className="repayment-row">
          {(['senderId', 'recipientId'] as const).map((key) => (
            <SelectField
              key={key}
              id={fieldId(key)}
              label={key === 'senderId' ? 'Sender' : 'Recipient'}
              value={values[key]}
              onChange={(event) => change({ [key]: event.target.value })}
              error={submitted ? errors[key] : undefined}
            >
              <option value="">Choose a member</option>
              {snapshot.members
                .filter((member) => member.status === 'active')
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </SelectField>
          ))}
          <Field
            id={fieldId('amount')}
            label="Amount (USD)"
            inputMode="decimal"
            value={values.amount}
            onChange={(event) => change({ amount: event.target.value })}
            error={submitted ? errors.amount : undefined}
            hint="Positive amount, up to two decimal places"
          />
          <Field
            id={fieldId('effectiveDate')}
            label="Repayment date"
            type="date"
            value={values.effectiveDate}
            onChange={(event) => change({ effectiveDate: event.target.value })}
            error={submitted ? errors.effectiveDate : undefined}
          />
        </div>
        <Field
          id={fieldId('note')}
          label="Note (optional)"
          maxLength={2000}
          value={values.note}
          onChange={(event) => change({ note: event.target.value })}
          error={submitted ? errors.note : undefined}
        />
        <section
          className="repayment-preview"
          aria-label="Balance preview"
          aria-live="polite"
        >
          {result.preview ? (
            <>
              <p>
                <strong>Before:</strong>{' '}
                {balanceSentence(
                  snapshot,
                  values.senderId,
                  values.recipientId,
                  result.preview.before,
                )}
              </p>
              <p>
                <strong>After:</strong>{' '}
                {balanceSentence(
                  snapshot,
                  values.senderId,
                  values.recipientId,
                  result.preview.after,
                )}
              </p>
            </>
          ) : (
            <p>
              Choose distinct members and a valid amount to preview the balance.
            </p>
          )}
        </section>
        {result.preview?.requiresAcknowledgment && (
          <div>
            <label className="repayment-ack" htmlFor={fieldId('acknowledged')}>
              <input
                id={fieldId('acknowledged')}
                type="checkbox"
                checked={
                  values.acknowledged &&
                  values.acknowledgedBefore === result.preview.before
                }
                onChange={(event) =>
                  change({
                    acknowledged: event.target.checked,
                    acknowledgedBefore: result.preview?.before ?? null,
                  })
                }
                aria-describedby={
                  submitted && errors.acknowledged
                    ? 'repayment-ack-error'
                    : undefined
                }
              />
              I understand that the recipient will owe the sender after this
              repayment.
            </label>
            {submitted && errors.acknowledged && (
              <p className="ui-error" id="repayment-ack-error">
                {errors.acknowledged}
              </p>
            )}
          </div>
        )}
      </fieldset>
      <CommandFeedback
        state={state}
        onRecover={
          draft ? () => void creation.recover(draft.operationId) : undefined
        }
        recoveryLabel="Check repayment status and retry safely"
      />
      <div className="ui-actions">
        <Button tone="secondary" onClick={() => returnToSource(visit)}>
          {draft ? 'Leave and preserve draft' : 'Cancel'}
        </Button>
        <Button
          type="submit"
          pending={state?.phase === 'submitting'}
          disabled={locked || disabled}
        >
          Record repayment
        </Button>
      </div>
    </form>
  );
}
export function RecordRepayment() {
  const { snapshot, status, refresh } = useAppData();
  const { returnToSource } = useExpenseNavigation();
  const visit = useSearchParams().get('visit');
  const heading = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      title="Record repayment"
      onClose={() => returnToSource(visit)}
      initialFocusRef={heading}
    >
      <div className="repayment-form" ref={heading} tabIndex={-1}>
        {snapshot && ['ready', 'refreshing', 'stale'].includes(status) ? (
          <RepaymentFields
            snapshot={snapshot}
            disabled={status !== 'ready'}
            visit={visit}
          />
        ) : status === 'loading' ? (
          <Skeleton label="Loading repayment form" />
        ) : (
          <Status kind="denied">
            This household is unavailable to this session. Your draft is
            retained and financial fields are hidden.
            <Button onClick={() => void refresh()}>Try again</Button>
          </Status>
        )}
      </div>
    </Dialog>
  );
}
