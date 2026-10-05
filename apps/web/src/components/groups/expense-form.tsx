'use client';
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
  categories,
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
}: {
  scope: FinancialScope;
  group: string;
  today: string;
  payer: string;
  members: readonly Member[];
  onCommitted: (expenseId: string) => Promise<void>;
  onDenied?: () => void;
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
    if (attempt || draft.description || draft.amount || draft.note)
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
      persist({ version: 1, actor: scope.actor, group, draft: value });
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
          `Expense saved once. Reference: ${outcome.record.expenseId}. Current balances were requested separately; check their status below.`,
        );
    } else if (outcome.__typename === 'ValidationProblem') {
      persist({ version: 1, actor: scope.actor, group, draft });
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
      persist({ version: 1, actor: scope.actor, group, draft, attempt: input });
      setAttempt(input);
      await send(input);
    });
  };
  const field = (key: string) => ({
    'aria-invalid': submitted && !!checked.errors[key],
    'aria-describedby':
      submitted && checked.errors[key] ? `expense-${key}-error` : undefined,
  });
  return (
    <section aria-labelledby="new-expense-title">
      <h2 id="new-expense-title">Add expense</h2>
      <p>Record a shared expense in this group. No money is moved.</p>
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
            <legend>Expense details</legend>
            <label htmlFor="expense-description">Description</label>
            <input
              id="expense-description"
              value={draft.description}
              onChange={(e) => change({ description: e.target.value })}
              {...field('description')}
            />
            <label htmlFor="expense-amount">Amount (USD)</label>
            <input
              id="expense-amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => change({ amount: e.target.value })}
              {...field('amount')}
            />
            <label htmlFor="expense-date">Date</label>
            <input
              id="expense-date"
              type="date"
              value={draft.date}
              onChange={(e) => change({ date: e.target.value })}
              {...field('date')}
            />
            <label htmlFor="expense-category">Category</label>
            <select
              id="expense-category"
              value={draft.category}
              onChange={(e) =>
                change({ category: e.target.value as Draft['category'] })
              }
              {...field('category')}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category[0] + category.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <label htmlFor="expense-note">Note</label>
            <textarea
              id="expense-note"
              value={draft.note}
              onChange={(e) => change({ note: e.target.value })}
              {...field('note')}
            />
            <label htmlFor="expense-payer">Paid by</label>
            <select
              id="expense-payer"
              value={draft.payer}
              onChange={(e) => change({ payer: e.target.value })}
              {...field('payer')}
            >
              <option value="">Select payer</option>
              {members
                .filter((m) => m.canParticipate)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
            </select>
            <label htmlFor="expense-split">Split</label>
            <select
              id="expense-split"
              value={draft.split}
              onChange={(e) =>
                change({ split: e.target.value as Draft['split'] })
              }
            >
              <option value="EQUAL">Equal</option>
              <option value="EXACT">Exact</option>
            </select>
            <fieldset {...field('participants')} tabIndex={-1}>
              <legend>Participants and preview</legend>
              {members
                .filter((m) => m.canParticipate)
                .map((member) => (
                  <div key={member.id} className="financial-participant">
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.participants.includes(member.id)}
                        onChange={(e) =>
                          change({
                            participants: e.target.checked
                              ? [...draft.participants, member.id]
                              : draft.participants.filter(
                                  (id) => id !== member.id,
                                ),
                          })
                        }
                      />
                      {member.displayName}
                    </label>
                    {draft.split === 'EXACT' &&
                    draft.participants.includes(member.id) ? (
                      <label>
                        Exact USD for {member.displayName}
                        <input
                          inputMode="decimal"
                          value={draft.exact[member.id] ?? ''}
                          onChange={(e) =>
                            change({
                              exact: {
                                ...draft.exact,
                                [member.id]: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ) : (
                      <span>
                        {checked.allocations.find(
                          (a) => a.participantId === member.id,
                        )
                          ? money(
                              checked.allocations.find(
                                (a) => a.participantId === member.id,
                              )!.amountMinor,
                            )
                          : 'Not included'}
                      </span>
                    )}
                  </div>
                ))}
            </fieldset>
            {submitted &&
              Object.entries(checked.errors).map(([key, error]) => (
                <p
                  className="financial-error"
                  id={`expense-${key}-error`}
                  key={key}
                >
                  {error}
                </p>
              ))}
            <button type="submit">Save expense</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
