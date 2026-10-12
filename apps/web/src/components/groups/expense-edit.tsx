'use client';
import { useEffect, useRef, useState } from 'react';
import { commitMutation, fetchQuery } from 'relay-runtime';
import mutation, {
  type expenseEditMutation,
} from '@/lib/relay/__generated__/expenseEditMutation.graphql';
import recovery, {
  type expenseEditRecoveryQuery,
} from '@/lib/relay/__generated__/expenseEditRecoveryQuery.graphql';
import document, {
  type journeyExpenseQuery,
} from '@/lib/relay/__generated__/journeyExpenseQuery.graphql';
import { type FinancialScope } from '@/lib/relay/environment';
import {
  createInput,
  validate,
  type Draft,
  type Member,
} from '@/lib/relay/draft';
import {
  expenseDraft,
  readEditDraft,
  saveEditDraft,
  removeEditDraft,
  type EditableExpense,
  type EditDraft,
} from '@/lib/relay/edit-draft';
import { createSessionId } from '@/lib/session-id';
import { ExpenseFields } from './expense-fields';
import { CategoryIcon } from '@/components/workspace-identity';
import { Money } from '@/components/primitives';
import { overviewDate } from './overview-date';
import { money } from '@/lib/relay/money';
type Outcome =
  | expenseEditMutation['response']['updateExpense']
  | expenseEditRecoveryQuery['response']['updateExpenseOperation'];
export function ExpenseEdit({
  scope,
  expense,
  members,
  onCancel,
  onCommitted,
  onDenied,
}: {
  scope: FinancialScope;
  expense: EditableExpense;
  members: readonly Member[];
  onCancel: () => void;
  onCommitted: () => Promise<void>;
  onDenied: () => void;
}) {
  const [initial] = useState(() => {
    try {
      return { value: readEditDraft(scope.actor, expense.groupId, expense.id) };
    } catch {
      return { error: true };
    }
  });
  const [draft, setDraft] = useState(
    initial.value?.draft ?? expenseDraft(expense),
  );
  const [baseVersion, setBaseVersion] = useState(
    initial.value?.baseVersion ?? expense.version,
  );
  const [attempt, setAttempt] = useState(initial.value?.attempt);
  const [blocked, setBlocked] = useState(!!initial.error);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(true);
  const [cancel, setCancel] = useState(false);
  const [conflict, setConflict] = useState(
    initial.value != null &&
      initial.value.baseVersion !== expense.version &&
      !initial.value.attempt,
  );
  const [latest, setLatest] = useState<EditableExpense>();
  const [notice, setNotice] = useState(
    initial.error
      ? 'Saved edit cannot be read. Restore tab storage access and reload before saving.'
      : '',
  );
  const alive = useRef(true),
    pending = useRef(false),
    form = useRef<HTMLFormElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    status = useRef<HTMLParagraphElement>(null);
  const current = () => alive.current && scope.isLive();
  const checked = validate(draft, members);
  const unchanged = (() => {
    try {
      return (
        JSON.stringify(
          createInput(draft, members, expense.groupId, 'compare'),
        ) ===
        JSON.stringify(
          createInput(
            expenseDraft(latest ?? expense),
            members,
            expense.groupId,
            'compare',
          ),
        )
      );
    } catch {
      return false;
    }
  })();
  useEffect(() => {
    alive.current = true;
    heading.current?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    if (!unchanged || attempt) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unchanged, attempt]);
  const persist = (
    value: Draft,
    original: typeof attempt | null = attempt,
    version = baseVersion,
  ) => {
    const saved: EditDraft = {
      version: 1,
      actor: scope.actor,
      group: expense.groupId,
      expense: expense.id,
      baseVersion: version,
      draft: value,
      ...(original ? { attempt: original } : {}),
    };
    try {
      saveEditDraft(saved);
    } catch {
      setBlocked(true);
      throw new Error('STORAGE');
    }
  };
  const change = (patch: Partial<Draft>) => {
    if (attempt || busy || blocked || conflict) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    try {
      persist(next);
    } catch {
      setNotice(
        'Tab storage is unavailable. Nothing new was sent. Restore storage access and reload.',
      );
    }
  };
  const accept = async (
    outcome: Outcome,
    original: NonNullable<typeof attempt>,
  ) => {
    if (!current()) return;
    if ('key' in outcome && outcome.key !== original.key)
      throw new Error('MISMATCH');
    if (outcome.__typename === 'ExpenseEditCommitted') {
      if (
        outcome.record.expenseId !== expense.id ||
        outcome.record.groupId !== expense.groupId
      )
        throw new Error('MISMATCH');
      setAttempt(undefined);
      setBlocked(true);
      let cleared = true;
      try {
        removeEditDraft(scope.actor, expense.groupId, expense.id);
      } catch {
        cleared = false;
      }
      // Server confirmation remains authoritative even when local cleanup fails.
      // A retained same-key attempt can only recover this original success.
      setNotice(
        cleared
          ? 'Edit saved. Refreshing current authorized expenses and balances…'
          : 'Edit saved. Its local recovery record could not be cleared. Refreshing current data; restore tab storage before another edit.',
      );
      try {
        await onCommitted();
      } catch {
        if (current())
          setNotice(
            'Edit saved. Current data is unavailable; refresh to check the latest expense and balances.',
          );
      }
    } else if (outcome.__typename === 'ExpenseEditConflict') {
      persist(draft, null);
      setAttempt(undefined);
      setConflict(true);
      setLatest(undefined);
      setNotice(
        'Someone changed this expense. Your draft is retained separately. Reload the latest expense, review it, then explicitly reapply your draft.',
      );
    } else if (outcome.__typename === 'ExpenseEditLocked') {
      persist(draft, null);
      setAttempt(undefined);
      setBlocked(true);
      setNotice(
        outcome.reason === 'FORMER_MEMBER'
          ? 'This expense cannot be edited because it involves a member who has left the group.'
          : 'This expense is currently ineligible for editing. Refresh current access.',
      );
    } else if (outcome.__typename === 'ValidationProblem') {
      persist(draft, null);
      setAttempt(undefined);
      setNotice(outcome.fields.map((f) => f.message).join(' '));
    } else if (
      outcome.__typename === 'Problem' &&
      outcome.code === 'NOT_FOUND'
    ) {
      setBlocked(true);
      setNotice(
        'Expense unavailable or access denied. The original edit remains retained.',
      );
      onDenied();
    } else
      setNotice(
        outcome.__typename === 'OperationMismatch'
          ? 'This key belongs to different inputs. Keep the original attempt and recover its result.'
          : 'The original result is not confirmed. A missing result does not prove failure. Recover again or retry only the frozen original edit.',
      );
  };
  const run = async (work: () => Promise<void>) => {
    if (pending.current || blocked) return;
    pending.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (current()) {
        if (
          error instanceof Error &&
          ['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(error.message)
        ) {
          setBlocked(true);
          onDenied();
        }
        setNotice(
          'The result is uncertain or unavailable. Keep the frozen edit and recover its result. No automatic resubmission was made.',
        );
      }
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
      commitMutation<expenseEditMutation>(scope.environment, {
        mutation,
        variables: { input },
        onCompleted: (result, errors) => {
          if (errors?.length || !result.updateExpense) {
            reject(new Error('UNKNOWN'));
            return;
          }
          void accept(result.updateExpense, input).then(resolve, reject);
        },
        onError: reject,
      });
    });
  const discard = () => {
    try {
      removeEditDraft(scope.actor, expense.groupId, expense.id);
      onCancel();
    } catch {
      setBlocked(true);
      setNotice(
        'Saved draft could not be cleared. Restore storage access before discarding.',
      );
    }
  };
  return (
    <section
      className="financial-form-card"
      aria-labelledby="edit-expense-title"
    >
      <h2 id="edit-expense-title" ref={heading} tabIndex={-1}>
        Edit expense
      </h2>
      <div className="expense-detail-identity">
        <CategoryIcon category={expense.category} />
        <h2>{expense.description}</h2>
      </div>
      <p className="expense-detail-total">
        <Money value={money(expense.totalMinor)} currency={expense.currency} />
      </p>
      <p className="expense-paid-by">
        {expense.payer.displayName} paid ·{' '}
        <time dateTime={expense.effectiveDate}>
          {overviewDate(expense.effectiveDate)}
        </time>
      </p>
      <p role="status" ref={status} tabIndex={-1} className="financial-notice">
        {busy ? 'Working…' : notice}
      </p>
      {attempt && (
        <aside className="financial-recovery">
          <h3>Unconfirmed original edit</h3>
          <p>
            The expense, version, key and input are frozen. Recovery survives
            reload in this tab; signing out or closing the tab clears this
            recovery context.
          </p>
          <button
            disabled={busy || blocked}
            onClick={() =>
              void run(async () => {
                const result = await fetchQuery<expenseEditRecoveryQuery>(
                  scope.environment,
                  recovery,
                  { groupId: expense.groupId, key: attempt.key },
                  { fetchPolicy: 'network-only' },
                ).toPromise();
                if (!result) throw new Error('UNKNOWN');
                await accept(result.updateExpenseOperation, attempt);
              })
            }
          >
            Recover original edit
          </button>
          <button
            disabled={busy || blocked}
            onClick={() => void run(() => send(attempt))}
          >
            Retry original edit
          </button>
        </aside>
      )}
      {conflict && (
        <aside className="financial-recovery">
          <h3>Review a newer expense</h3>
          <p>Your draft has not replaced the latest saved expense.</p>
          <button
            disabled={busy || blocked}
            onClick={() =>
              void run(async () => {
                const result = await fetchQuery<journeyExpenseQuery>(
                  scope.environment,
                  document,
                  { id: expense.id },
                  { fetchPolicy: 'network-only' },
                ).toPromise();
                if (!current()) return;
                const node = result?.node;
                if (
                  node?.__typename !== 'Expense' ||
                  node.id !== expense.id ||
                  node.groupId !== expense.groupId
                ) {
                  setBlocked(true);
                  onDenied();
                  return;
                }
                setLatest(node);
              })
            }
          >
            Reload latest expense
          </button>
          {latest && (
            <>
              <h4>Latest saved values</h4>
              <dl>
                <dt>Description</dt>
                <dd>{latest.description}</dd>
                <dt>Amount</dt>
                <dd>{money(latest.totalMinor)}</dd>
                <dt>Date / category</dt>
                <dd>
                  {latest.effectiveDate} · {latest.category}
                </dd>
                <dt>Payer</dt>
                <dd>{latest.payer.displayName}</dd>
                <dt>Split</dt>
                <dd>
                  {latest.split}:{' '}
                  {latest.allocations
                    .map(
                      (a) =>
                        `${a.participant.displayName} ${money(a.amountMinor)}${a.percentageHundredths == null ? '' : ` (${a.percentageHundredths / 100}%)`}`,
                    )
                    .join('; ')}
                </dd>
                <dt>Note</dt>
                <dd className="expense-note">{latest.note || 'No note'}</dd>
              </dl>
              <button
                disabled={!latest.canEdit || busy || blocked}
                onClick={() => {
                  try {
                    persist(draft, null, latest.version);
                    setBaseVersion(latest.version);
                    setConflict(false);
                    setNotice(
                      'Your draft is reapplied against the reviewed version. Review the fields and save explicitly.',
                    );
                  } catch {
                    setNotice('Storage unavailable. Draft not reapplied.');
                  }
                }}
              >
                Reapply my draft to this version
              </button>
              {!latest.canEdit && <p>This expense is currently read-only.</p>}
            </>
          )}
        </aside>
      )}
      <form
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (attempt || conflict || blocked || unchanged || pending.current)
            return;
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
            const input = {
              ...createInput(
                draft,
                members,
                expense.groupId,
                createSessionId(),
              ),
              expenseId: expense.id,
              expectedVersion: baseVersion,
            };
            persist(draft, input);
            setAttempt(input);
            await send(input);
          });
        }}
      >
        <fieldset
          className="expense-edit-fields"
          disabled={busy || !!attempt || blocked || conflict}
        >
          <ExpenseFields
            draft={draft}
            members={members}
            change={change}
            submitted={submitted}
          />
        </fieldset>
        <div className="expense-edit-actions">
          {!attempt && (
            <button
              type="button"
              className="ui-button ui-button--text"
              disabled={busy}
              onClick={() => {
                if (unchanged) discard();
                else setCancel(true);
              }}
            >
              Cancel editing
            </button>
          )}
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={
              busy ||
              !!attempt ||
              blocked ||
              conflict ||
              unchanged ||
              Object.keys(checked.errors).length > 0
            }
          >
            Save changes
          </button>
        </div>
      </form>
      <p className="expense-edit-hint">
        Closing keeps your draft until you save or discard.
      </p>
      <details className="expense-edit-help">
        <summary>About financial changes</summary>
        <p>
          Financial changes can change balances, including previously settled
          balances. Recorded repayments stay unchanged. No money is moved.
        </p>
      </details>
      {cancel && (
        <aside role="alert">
          <p>Discard your unsaved changes and return to the expense?</p>
          <button onClick={discard}>Discard changes</button>
          <button onClick={() => setCancel(false)}>Keep editing</button>
        </aside>
      )}
    </section>
  );
}
