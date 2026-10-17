'use client';
import { createSessionId } from '@/lib/session-id';
import { useEffect, useRef, useState } from 'react';
import { commitMutation, fetchQuery } from 'relay-runtime';
import mutation, {
  type journeyRepaymentMutation,
} from '@/lib/relay/__generated__/journeyRepaymentMutation.graphql';
import recovery, {
  type journeyRepaymentRecoveryQuery,
} from '@/lib/relay/__generated__/journeyRepaymentRecoveryQuery.graphql';
import {
  amountText,
  readRepayment,
  removeRepayment,
  saveRepayment,
  validateRepayment,
  type RepaymentDraft,
  type SavedRepayment,
} from '@/lib/relay/repayment-draft';
import type { Member } from '@/lib/relay/draft';
import type { FinancialScope } from '@/lib/relay/environment';
import { money } from '@/lib/relay/money';
import { ErrorSummary } from '../ui/primitives';

import formsFeatureStyles from './forms.module.css';

type Outcome =
  | journeyRepaymentMutation['response']['recordRepayment']
  | journeyRepaymentRecoveryQuery['response']['repaymentOperation'];
export function RepaymentForm({
  scope,
  group,
  name,
  today,
  sender,
  recipient,
  suggested,
  members,
  onCommitted,
  onDenied,
}: {
  scope: FinancialScope;
  group: string;
  name: string;
  today: string;
  sender: string;
  recipient: string;
  suggested: string;
  members: readonly Member[];
  onCommitted: () => Promise<void>;
  onDenied: () => void;
}) {
  const [initial] = useState(() => {
    try {
      return { value: readRepayment(scope.actor, group) };
    } catch {
      return { error: true };
    }
  });
  const [draft, setDraft] = useState<RepaymentDraft>(
    initial.value?.draft ?? {
      sender,
      recipient,
      amount: amountText(suggested),
      date: today,
      note: '',
    },
  );
  const [attempt, setAttempt] = useState(initial.value?.attempt);
  const [storageFailed, setStorageFailed] = useState(!!initial.error);
  const [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState(
    initial.error
      ? 'Saved repayment cannot be safely read. Submission is blocked to preserve any unresolved attempt. Restore tab storage and reload.'
      : initial.value
        ? 'Restored your saved repayment for this space. Review its people and amount; the selected balance is only a suggestion.'
        : '',
  );
  const alive = useRef(true),
    pending = useRef(false),
    status = useRef<HTMLParagraphElement>(null);
  const checked = validateRepayment(draft, members);
  const current = () => alive.current && scope.isLive();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    if (attempt || draft.amount || draft.note)
      window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, attempt]);
  function persist(value: SavedRepayment) {
    try {
      saveRepayment(value);
    } catch {
      setStorageFailed(true);
      throw new Error('STORAGE');
    }
  }
  function change(patch: Partial<RepaymentDraft>) {
    if (attempt || busy || storageFailed) return;
    const value = { ...draft, ...patch };
    setDraft(value);
    try {
      persist({ version: 1, actor: scope.actor, group, draft: value });
    } catch {
      setNotice(
        'Tab storage is unavailable. No new repayment was sent. Restore storage and reload.',
      );
    }
  }
  async function accept(
    outcome: Outcome,
    original: NonNullable<typeof attempt>,
  ) {
    if (!current()) return;
    if ('key' in outcome && outcome.key !== original.key)
      throw new Error('UNKNOWN');
    if (outcome.__typename === 'RepaymentCommitted') {
      const r = outcome.record;
      if (
        r.groupId !== original.groupId ||
        r.senderMembershipId !== original.senderId ||
        r.recipientMembershipId !== original.recipientId ||
        r.amountMinor !== original.amountMinor ||
        r.currency !== original.currency ||
        r.effectiveDate !== original.effectiveDate ||
        r.note !== original.note
      )
        throw new Error('UNKNOWN');
      removeRepayment(group);
      setAttempt(undefined);
      setSubmitted(false);
      setDraft({
        sender: draft.sender,
        recipient: draft.recipient,
        amount: '',
        date: today,
        note: '',
      });
      setNotice(
        `Recorded ${money(r.amountMinor)} once. No money was moved. Refreshing balances and recent repayments…`,
      );
      await onCommitted();
    } else if (outcome.__typename === 'ValidationProblem') {
      persist({ version: 1, actor: scope.actor, group, draft });
      setAttempt(undefined);
      setNotice(
        `Repayment rejected: ${outcome.fields.map((f) => f.message).join(' ')} Correct the draft before a new operation.`,
      );
    } else if (
      outcome.__typename === 'Problem' &&
      [
        'NOT_FOUND',
        'UNAUTHENTICATED',
        'DISABLED',
        'UNPROVISIONED',
        'FORBIDDEN',
      ].includes(outcome.code)
    ) {
      setDenied(true);
      onDenied();
    } else
      setNotice(
        outcome.__typename === 'OperationMismatch'
          ? 'This key identifies different original input. Keep the attempt and recover its original result.'
          : 'Result not confirmed. A missing result does not prove failure. Check again or retry only the original repayment.',
      );
  }
  async function run(work: () => Promise<void>) {
    if (pending.current || storageFailed || denied) return;
    pending.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if (current()) {
        if (
          e instanceof Error &&
          ['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(e.message)
        ) {
          setDenied(true);
          onDenied();
        }
        setNotice(
          'The result is uncertain or unavailable. Keep the original attempt and check its result. No automatic resubmission was made.',
        );
      }
    } finally {
      pending.current = false;
      if (current()) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (current()) status.current?.focus();
        });
      }
    }
  }
  function send(input: NonNullable<typeof attempt>) {
    return new Promise<void>((resolve, reject) =>
      commitMutation<journeyRepaymentMutation>(scope.environment, {
        mutation,
        variables: { input },
        onCompleted: (data, errors) => {
          if (errors?.length || !data.recordRepayment) {
            reject(new Error('UNKNOWN'));
            return;
          }
          void accept(data.recordRepayment, input).then(resolve, reject);
        },
        onError: reject,
      }),
    );
  }
  const disabled = busy || !!attempt || storageFailed || denied;
  return (
    <section
      data-ui="financial-form-card form-region"
      className={formsFeatureStyles['financial-form-card']}
      aria-labelledby="repayment-heading"
    >
      <h1 id="repayment-heading" tabIndex={-1}>
        Record repayment · {name}
      </h1>
      <p>
        Record money already transferred in this group. Recording does not move
        money. Partial repayments and overpayments are allowed.
      </p>
      <p aria-label="Transfer to record">
        {members.find((member) => member.id === draft.sender)?.displayName ??
          'Choose sender'}
        {' paid '}
        {members.find((member) => member.id === draft.recipient)?.displayName ??
          'choose recipient'}
        {' · '}
        {!checked.errors.amount
          ? money(checked.amount) + ' USD'
          : 'Enter a valid amount'}
        {' · Original group: '}
        {name}
      </p>
      <p ref={status} role="status" tabIndex={-1}>
        {busy ? 'Working…' : notice}
      </p>
      {attempt && (
        <aside
          data-ui="financial-recovery"
          className={formsFeatureStyles['financial-recovery']}
        >
          <h3>Unconfirmed original repayment</h3>
          <p>
            The original group, sender, recipient, input and operation key are
            frozen. Leaving preserves this attempt in this tab.
          </p>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() =>
              void run(async () => {
                const result = await fetchQuery<journeyRepaymentRecoveryQuery>(
                  scope.environment,
                  recovery,
                  { groupId: attempt.groupId, key: attempt.key },
                  { fetchPolicy: 'network-only' },
                ).toPromise();
                if (!result) throw new Error('UNKNOWN');
                await accept(result.repaymentOperation, attempt);
              })
            }
            data-ui="form-button"
          >
            Recover original repayment
          </button>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() => void run(() => send(attempt))}
            data-ui="form-button"
          >
            Retry original repayment
          </button>
        </aside>
      )}
      {!denied && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (pending.current || disabled) return;
            setSubmitted(true);
            if (Object.keys(checked.errors).length) {
              const first = Object.keys(checked.errors)[0];
              document.getElementById(`repayment-${first}`)?.focus();
              return;
            }
            void run(async () => {
              const input = {
                groupId: group,
                key: createSessionId(),
                senderId: draft.sender,
                recipientId: draft.recipient,
                amountMinor: checked.amount,
                currency: 'USD' as const,
                effectiveDate: draft.date,
                note: draft.note,
              };
              persist({
                version: 1,
                actor: scope.actor,
                group,
                draft,
                attempt: input,
              });
              setAttempt(input);
              await send(input);
            });
          }}
        >
          {submitted && (
            <ErrorSummary
              errors={Object.entries(checked.errors).map(([key, message]) => ({
                fieldId: `repayment-${key}`,
                message,
              }))}
            />
          )}
          <fieldset
            data-ui="financial-entry-fields form-fieldset"
            className={formsFeatureStyles['financial-entry-fields']}
            disabled={disabled}
          >
            <legend>Original group: {name}</legend>
            {(['sender', 'recipient'] as const).map((key) => (
              <div
                data-ui="financial-field"
                className={formsFeatureStyles['financial-field']}
                key={key}
              >
                <label htmlFor={`repayment-${key}`} data-ui="form-label">
                  {key === 'sender' ? 'Sender' : 'Recipient'}
                </label>
                <select
                  id={`repayment-${key}`}
                  value={draft[key]}
                  onChange={(e) => change({ [key]: e.target.value })}
                  aria-invalid={submitted && !!checked.errors[key]}
                  data-ui="form-control"
                >
                  <option value="">Choose {key}</option>
                  {members
                    .filter((m) => m.canParticipate || m.id === draft[key])
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
              </div>
            ))}
            <div
              data-ui="financial-field"
              className={formsFeatureStyles['financial-field']}
            >
              <label htmlFor="repayment-amount" data-ui="form-label">
                Amount (USD)
              </label>
              <input
                id="repayment-amount"
                inputMode="decimal"
                value={draft.amount}
                aria-invalid={submitted && !!checked.errors.amount}
                onChange={(e) => change({ amount: e.target.value })}
                data-ui="form-control"
              />
            </div>
            <div
              data-ui="financial-field"
              className={formsFeatureStyles['financial-field']}
            >
              <label htmlFor="repayment-date" data-ui="form-label">
                Transfer date
              </label>
              <input
                id="repayment-date"
                type="date"
                value={draft.date}
                aria-invalid={submitted && !!checked.errors.date}
                onChange={(e) => change({ date: e.target.value })}
                data-ui="form-control"
              />
            </div>
            <div
              data-ui="financial-field"
              className={formsFeatureStyles['financial-field']}
            >
              <label htmlFor="repayment-note" data-ui="form-label">
                Optional note
              </label>
              <textarea
                id="repayment-note"
                value={draft.note}
                aria-invalid={submitted && !!checked.errors.note}
                onChange={(e) => change({ note: e.target.value })}
                data-ui="form-control"
              />
            </div>
            <button type="submit" data-ui="form-button">
              Record repayment
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
