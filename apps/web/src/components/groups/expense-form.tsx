'use client';
import { Button } from '@/components/primitives';
import { ExpenseFields } from './expense-fields';
import { createSessionId } from '@/lib/session-id';
import { useEffect, useRef, useState } from 'react';
import { commitMutation, fetchQuery } from 'relay-runtime';
import createDocument, {
  type journeyCreateMutation,
} from '@/lib/relay/__generated__/journeyCreateMutation.graphql';
import recoveryDocument, {
  type journeyRecoveryQuery,
} from '@/lib/relay/__generated__/journeyRecoveryQuery.graphql';
import {
  createInput,
  newDraft,
  readDraft,
  removeDraft,
  saveDraft,
  validate,
  type Draft,
  type Member,
  type SavedDraft,
} from '@/lib/relay/draft';
import { percentageText } from '@/lib/relay/percentage';
import { money } from '@/lib/relay/money';
import type { FinancialScope } from '@/lib/relay/environment';
type Outcome =
  | journeyCreateMutation['response']['createExpense']
  | journeyRecoveryQuery['response']['expenseOperation'];
export function ExpenseForm({
  scope,
  group,
  today,
  payer,
  members,
  onCommitted,
  onDenied,
  embedded = false,
  onCancel,
}: {
  scope: FinancialScope;
  group: string;
  today: string;
  payer: string;
  members: readonly Member[];
  onCommitted: (expenseId: string) => Promise<void>;
  onDenied?: () => void;
  embedded?: boolean;
  onCancel?: () => void;
}) {
  const [initial] = useState(() => {
    try {
      return { value: readDraft(scope.actor, group) };
    } catch {
      return {
        error:
          'The saved draft cannot be read. Saving is blocked to protect any unresolved attempt. Restore browser storage access and reload.',
      };
    }
  });
  const [draft, setDraft] = useState<Draft>(
    initial.value?.draft ?? newDraft(today, payer, members),
  );
  const [attempt, setAttempt] = useState(initial.value?.attempt);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.error ?? '');
  const [storageFailed, setStorageFailed] = useState(!!initial.error);
  const [submitted, setSubmitted] = useState(false);
  const [denied, setDenied] = useState(false);
  const alive = useRef(true),
    pending = useRef(false);
  const status = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const checked = validate(draft, members);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    if (
      attempt ||
      draft.description ||
      draft.amount ||
      draft.note ||
      draft.percentageInitialized
    )
      window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [attempt, draft]);
  const current = () => alive.current && scope.isLive();
  const persist = (value: SavedDraft) => {
    try {
      saveDraft(value);
    } catch {
      setStorageFailed(true);
      throw new Error(
        'Tab storage is unavailable. Nothing new was sent. Restore storage access and reload.',
      );
    }
  };
  const change = (patch: Partial<Draft>) => {
    if (attempt || busy || storageFailed) return;
    const value = { ...draft, ...patch };
    setDraft(value);
    try {
      persist({ version: 2, actor: scope.actor, group, draft: value });
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const accept = async (
    outcome: Outcome,
    original: NonNullable<typeof attempt>,
  ) => {
    if (!current()) return;
    if ('key' in outcome && outcome.key !== original.key)
      throw new Error('Unexpected operation result');
    if (outcome.__typename === 'ExpenseCommitted') {
      if (outcome.record.groupId !== group)
        throw new Error(
          'The result did not match the original group. Keep this attempt for recovery.',
        );
      removeDraft(group);
      setAttempt(undefined);
      setDraft(newDraft(today, payer, members));
      setSubmitted(false);
      setNotice(
        `Saved ${money(outcome.record.totalMinor)}. Expense reference: ${outcome.record.expenseId}. Refreshing current balances…`,
      );
      await onCommitted(outcome.record.expenseId);
      if (current())
        setNotice(
          `Expense saved once.${outcome.record.split === 'PERCENTAGE' ? ` Percentage intent: ${outcome.record.allocations.map((a) => `${percentageText(a.percentageHundredths ?? 0)}% — ${money(a.amountMinor)}`).join('; ')}.` : ''} Reference: ${outcome.record.expenseId}. Current balances were requested separately; check their status below.`,
        );
    } else if (outcome.__typename === 'ValidationProblem') {
      persist({ version: 2, actor: scope.actor, group, draft });
      setAttempt(undefined);
      setNotice(
        `Expense rejected: ${outcome.fields.map((field) => field.message).join(' ')} Correct the draft and save as a new operation.`,
      );
    } else if (
      outcome.__typename === 'Problem' &&
      outcome.code === 'NOT_FOUND'
    ) {
      setDenied(true);
      onDenied?.();
      setNotice(
        'This group is unavailable or access was denied. The original attempt is retained, but retry is blocked. Refresh group access before continuing.',
      );
    } else {
      setNotice(
        outcome.__typename === 'OperationMismatch'
          ? 'This key identifies different original inputs. Keep the attempt and recover its result; do not create a replacement.'
          : 'The original result is not yet confirmed. A missing result does not prove failure. Check again, or retry only the frozen original expense.',
      );
    }
  };
  const run = async (work: () => Promise<void>) => {
    if (pending.current || storageFailed || denied) return;
    pending.current = true;
    setBusy(true);
    setNotice('Checking the original expense…');
    try {
      await work();
    } catch (error) {
      if (
        current() &&
        error instanceof Error &&
        ['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(error.message)
      ) {
        setDenied(true);
        onDenied?.();
      }
      if (current())
        setNotice(
          'The result is uncertain or the service is unavailable. Keep the original attempt and check its status. No automatic resubmission was made.',
        );
    } finally {
      pending.current = false;
      if (current()) {
        setBusy(false);
        requestAnimationFrame(() => status.current?.focus());
      }
    }
  };
  const send = (input: NonNullable<typeof attempt>) =>
    new Promise<void>((resolve, reject) => {
      commitMutation<journeyCreateMutation>(scope.environment, {
        mutation: createDocument,
        variables: { input },
        onCompleted: (data, errors) => {
          if (errors?.length || !data.createExpense) {
            reject(new Error('UNKNOWN'));
            return;
          }
          void accept(data.createExpense, input).then(resolve, reject);
        },
        onError: reject,
      });
    });
  const submit = () => {
    if (pending.current || attempt || storageFailed || denied) return;
    setSubmitted(true);
    if (Object.keys(checked.errors).length) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    void run(async () => {
      const input = createInput(draft, members, group, createSessionId());
      // Persist both key and immutable input BEFORE invoking the network layer.
      persist({ version: 2, actor: scope.actor, group, draft, attempt: input });
      setAttempt(input);
      await send(input);
    });
  };
  return (
    <section
      className="financial-form-card"
      aria-labelledby={embedded ? undefined : 'new-expense-title'}
      aria-label={embedded ? 'Add expense' : undefined}
    >
      {!embedded && <h2 id="new-expense-title">Add expense</h2>}
      {!embedded && (
        <p>Record a shared expense in this group. No money is moved.</p>
      )}
      <p ref={status} role="status" tabIndex={-1} className="financial-notice">
        {busy ? 'Working…' : notice}
      </p>
      {attempt && (
        <aside className="financial-recovery">
          <h3>Unconfirmed original expense</h3>
          <p>
            The original group, key and input are frozen. Recovery survives
            reload in this tab, but signing out or closing the tab loses this
            recovery context. Server records remain with financial history.
          </p>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() =>
              void run(async () => {
                const result = await fetchQuery<journeyRecoveryQuery>(
                  scope.environment,
                  recoveryDocument,
                  { groupId: attempt.groupId, key: attempt.key },
                  { fetchPolicy: 'network-only' },
                ).toPromise();
                if (!result) throw new Error('UNKNOWN');
                await accept(result.expenseOperation, attempt);
              })
            }
          >
            Recover original result
          </button>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() => void run(() => send(attempt))}
          >
            Retry original expense
          </button>
        </aside>
      )}
      {!denied && (
        <form
          ref={form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          <fieldset disabled={busy || !!attempt || storageFailed}>
            <ExpenseFields
              draft={draft}
              members={members}
              change={change}
              submitted={submitted}
            />
          </fieldset>
          <div className="expense-create-actions">
            {onCancel && (
              <Button
                tone="text"
                type="button"
                onClick={onCancel}
                disabled={busy || !!attempt || storageFailed}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                busy ||
                !!attempt ||
                storageFailed ||
                (draft.split === 'PERCENTAGE' &&
                  Object.keys(checked.errors).length > 0)
              }
            >
              {embedded ? 'Add expense' : 'Save expense'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
