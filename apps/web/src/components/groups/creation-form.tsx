'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { commitMutation, fetchQuery } from 'relay-runtime';
import mutation, {
  type journeyGroupCreationMutation,
} from '@/lib/relay/__generated__/journeyGroupCreationMutation.graphql';
import recovery, {
  type journeyGroupCreationRecoveryQuery,
} from '@/lib/relay/__generated__/journeyGroupCreationRecoveryQuery.graphql';
import groupDocument, {
  type journeyGroupQuery,
} from '@/lib/relay/__generated__/journeyGroupQuery.graphql';
import {
  creationInput,
  readCreation,
  saveCreation,
  removeCreation,
  validateCreation,
  type CreationDraft,
  type SavedCreation,
} from '@/lib/relay/group-creation';
import { createSessionId } from '@/lib/session-id';
import type { FinancialScope } from '@/lib/relay/environment';
import { ErrorSummary, Button } from '../ui/primitives';
import creationStyles from './creation.module.css';

import { AppIcon } from '@/components/workspace-identity';

type Outcome =
  | journeyGroupCreationMutation['response']['createGroup']
  | journeyGroupCreationRecoveryQuery['response']['groupCreationOperation'];
export function CreationForm({
  source,
  returnHref,
  scope,
  actor,
  today,
  kind,
  onDenied,
}: {
  source?: string;
  returnHref?: string;
  scope: FinancialScope;
  actor: string;
  today: string;
  kind: 'ORDINARY' | 'TRIP';
  onDenied: () => void;
}) {
  const router = useRouter();
  const [initial] = useState(() => {
    try {
      return { value: readCreation(actor) };
    } catch {
      return { error: true };
    }
  });
  const [draft, setDraft] = useState<CreationDraft>(
    initial.value?.draft ?? {
      name: '',
      kind,
      destination: '',
      startDate: today,
      endDate: today,
    },
  );
  const [attempt, setAttempt] = useState(initial.value?.attempt);
  const [storageFailed, setStorageFailed] = useState(!!initial.error);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(
    initial.value?.attempt
      ? 'An earlier creation is unconfirmed. Check its original result before continuing.'
      : '',
  );
  const navigating = useRef(false);
  const alive = useRef(true),
    pending = useRef(false),
    status = useRef<HTMLParagraphElement>(null);
  const current = () =>
    alive.current && scope.isLive() && document.visibilityState !== 'hidden';
  useEffect(() => {
    alive.current = true;
    document.getElementById('creation-heading')?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    if (attempt || draft.name) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [attempt, draft.name]);
  function persist(value: SavedCreation) {
    try {
      saveCreation(value);
    } catch {
      setStorageFailed(true);
      throw new Error('STORAGE');
    }
  }
  function change(patch: Partial<CreationDraft>) {
    if (attempt || busy || storageFailed || denied) return;
    const value = { ...draft, ...patch };
    setDraft(value);
    setErrors({});
    try {
      persist({ version: 1, actor, draft: value });
    } catch {
      setNotice(
        'Tab storage is unavailable. No new creation was sent. Restore storage and reload.',
      );
    }
  }
  function deny() {
    setDenied(true);
    onDenied();
  }
  async function accept(
    outcome: Outcome,
    original: NonNullable<typeof attempt>,
  ) {
    if (!current()) return;
    if (
      'operationKey' in outcome &&
      outcome.operationKey !== original.operationKey
    )
      throw new Error('UNKNOWN');
    if (outcome.__typename === 'GroupCreationCompleted') {
      setNotice(
        'Creation confirmed. Reading current authorized group data before opening…',
      );
      const result = await fetchQuery<journeyGroupQuery>(
        scope.environment,
        groupDocument,
        { id: outcome.groupId },
        { fetchPolicy: 'network-only' },
      ).toPromise();
      if (!current()) return;
      if (
        result?.group?.__typename === 'Problem' &&
        [
          'NOT_FOUND',
          'FORBIDDEN',
          'DISABLED',
          'UNPROVISIONED',
          'UNAUTHENTICATED',
        ].includes(result.group.code)
      ) {
        deny();
        return;
      }
      if (
        result?.group?.__typename !== 'Group' ||
        result.group.id !== outcome.groupId ||
        result.group.balances?.__typename !== 'GroupBalances' ||
        !result.group.expenses
      ) {
        setNotice(
          'Creation completed, but current group data is unavailable. Keep this attempt and check again, or inspect your groups. No empty ledger or zero balance can be established.',
        );
        return;
      }
      removeCreation();
      // No state/focus updates after route transition; leaving this visit suppresses late responses.
      navigating.current = true;
      router.push(
        `${original.kind === 'TRIP' ? '/trips' : '/groups'}/${encodeURIComponent(outcome.groupId)}${source ? `?source=${encodeURIComponent(source)}` : ''}`,
      );
    } else if (outcome.__typename === 'GroupCreationRejected') {
      persist({ version: 1, actor, draft });
      setAttempt(undefined);
      const fields: Record<string, string> = {};
      for (const field of outcome.fields)
        fields[
          field.path
            .filter((part) => part !== 'input' && part !== 'trip')
            .join('.')
        ] = field.message;
      setErrors(fields);
      setNotice(
        'Creation rejected. Correct the fields; the next submission will use a new attempt.',
      );
    } else if (
      outcome.__typename === 'Problem' &&
      [
        'NOT_FOUND',
        'FORBIDDEN',
        'DISABLED',
        'UNPROVISIONED',
        'UNAUTHENTICATED',
      ].includes(outcome.code)
    )
      deny();
    else
      setNotice(
        outcome.__typename === 'GroupCreationConflict'
          ? 'This key identifies different input. Keep the original attempt and check its result. No new group was requested.'
          : 'No committed result is visible. The original request may still commit. Check again or retry only the same key and frozen input.',
      );
  }
  async function run(work: () => Promise<void>) {
    if (pending.current || storageFailed || denied || !current()) return;
    pending.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if (current()) {
        if (
          e instanceof Error &&
          ['UNAUTHENTICATED', 'SESSION_CHANGED'].includes(e.message)
        )
          deny();
        setNotice(
          'The result is uncertain or unavailable. Keep the original attempt and check creation. No automatic resubmission was made.',
        );
      }
    } finally {
      pending.current = false;
      if (current() && !navigating.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (current()) {
            const invalid = document.querySelector<HTMLInputElement>(
              '[id^="creation-"][aria-invalid="true"]',
            );
            (invalid ?? status.current)?.focus();
          }
        });
      }
    }
  }
  function send(input: NonNullable<typeof attempt>) {
    return new Promise<void>((resolve, reject) =>
      commitMutation<journeyGroupCreationMutation>(scope.environment, {
        mutation,
        variables: { input },
        onError: reject,
        onCompleted: (data, failures) => {
          if (failures?.length || !data.createGroup) {
            reject(new Error('UNKNOWN'));
            return;
          }
          void accept(data.createGroup, input).then(resolve, reject);
        },
      }),
    );
  }
  const disabled = busy || !!attempt || storageFailed || denied;
  function field(
    key: 'name' | 'destination' | 'startDate' | 'endDate',
    label: string,
    placeholder?: string,
  ) {
    return (
      <div className={creationStyles.field}>
        <label htmlFor={`creation-${key}`} data-ui="form-label">
          {label}
        </label>
        <input
          id={`creation-${key}`}
          type={key.endsWith('Date') ? 'date' : 'text'}
          value={draft[key]}
          onChange={(e) => change({ [key]: e.target.value })}
          placeholder={placeholder}
          autoComplete="off"
          required={key !== 'destination'}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `creation-${key}-error` : undefined}
          data-ui="form-control"
        />
        {errors[key] && (
          <p id={`creation-${key}-error`} className={creationStyles.error}>
            {errors[key]}
          </p>
        )}
      </div>
    );
  }
  return (
    <section
      data-ui="creation-form form-region"
      className={creationStyles.form}
      aria-labelledby="creation-heading"
    >
      <Link
        className={creationStyles.back}
        href={returnHref ?? '/groups'}
        scroll={false}
      >
        <span aria-hidden="true">←</span> Groups
      </Link>
      <h1 id="creation-heading" tabIndex={-1}>
        Create a shared space
      </h1>
      <p
        className={creationStyles.status}
        ref={status}
        role="status"
        tabIndex={-1}
      >
        {busy ? 'Working…' : notice}
      </p>
      {attempt && (
        <aside data-ui="financial-recovery" className={creationStyles.recovery}>
          <h3>Unconfirmed original creation</h3>
          <Link href={returnHref ?? '/groups'} scroll={false}>
            Inspect your groups
          </Link>
          <p>
            The original name, type, trip fields and key are frozen. Leaving
            preserves this attempt in this tab.
          </p>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() =>
              void run(async () => {
                const data =
                  await fetchQuery<journeyGroupCreationRecoveryQuery>(
                    scope.environment,
                    recovery,
                    { operationKey: attempt.operationKey },
                    { fetchPolicy: 'network-only' },
                  ).toPromise();
                if (!data) throw new Error('UNKNOWN');
                await accept(data.groupCreationOperation, attempt);
              })
            }
            data-ui="form-button"
          >
            Check creation
          </button>
          <button
            disabled={busy || storageFailed || denied}
            onClick={() => void run(() => send(attempt))}
            data-ui="form-button"
          >
            Retry original creation
          </button>
        </aside>
      )}
      {!attempt && !denied && storageFailed && (
        <aside data-ui="financial-recovery" className={creationStyles.recovery}>
          <p>
            Saved creation cannot be safely read or saved. If tab storage was
            lost, an earlier creation may have completed. Inspect your groups
            before deliberately creating another; a new key cannot deduplicate a
            lost attempt.
          </p>
          <Link href={returnHref ?? '/groups'} scroll={false}>
            Inspect your groups
          </Link>
          <label data-ui="form-label">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              data-ui="form-checkbox"
            />
            I have checked my groups and want a new creation.
          </label>
          <button
            disabled={!acknowledged}
            onClick={() => {
              try {
                // A valid saved attempt must never be discarded through this storage-loss path.
                const saved = readCreation(actor);
                if (saved?.attempt) {
                  setNotice(
                    'An original attempt is available. Reload to recover it.',
                  );
                  return;
                }
              } catch {
                /* Explicit acknowledgement permits replacing unreadable lost context. */
              }
              try {
                saveCreation({ version: 1, actor, draft });
                setStorageFailed(false);
                setNotice(
                  'Starting a deliberate new draft after storage loss. An earlier group may already exist.',
                );
              } catch {
                setNotice(
                  'Storage remains unavailable. Restore it and reload before submitting.',
                );
              }
            }}
            data-ui="form-button"
          >
            Start new draft after storage loss
          </button>
        </aside>
      )}
      {!denied && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (pending.current || disabled) return;
            const checked = validateCreation(draft);
            setErrors(checked.errors);
            if (Object.keys(checked.errors).length) {
              document
                .getElementById(`creation-${Object.keys(checked.errors)[0]}`)
                ?.focus();
              return;
            }
            void run(async () => {
              const input = creationInput(draft, createSessionId());
              persist({ version: 1, actor, draft, attempt: input });
              setAttempt(input);
              await send(input);
            });
          }}
        >
          <ErrorSummary
            errors={Object.entries(errors).map(([key, message]) => ({
              fieldId: `creation-${key}`,
              message,
            }))}
          />
          <fieldset
            data-ui="financial-entry-fields form-fieldset"
            className={creationStyles.fields}
            disabled={disabled}
          >
            <legend>Group details</legend>
            <div
              role="group"
              aria-label="Space type"
              id="creation-kind"
              className={creationStyles.kind}
            >
              {(['ORDINARY', 'TRIP'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.kind === value}
                  onClick={() => change({ kind: value })}
                >
                  <AppIcon name={value === 'TRIP' ? 'trip' : 'groups'} />
                  {value === 'TRIP' ? 'Trip' : 'Group'}
                </button>
              ))}
            </div>
            <p className={creationStyles.intro}>
              {draft.kind === 'TRIP'
                ? 'For a journey together.'
                : 'For ongoing shared expenses.'}
            </p>
            {field(
              'name',
              draft.kind === 'TRIP' ? 'Trip name' : 'Group name',
              draft.kind === 'TRIP'
                ? 'e.g. Summer in Italy'
                : 'e.g. Friday dinners',
            )}
            {draft.kind === 'TRIP' && (
              <>
                {field(
                  'destination',
                  'Destination (optional)',
                  'e.g. Maui, Hawaii',
                )}
                <div className={creationStyles.dates}>
                  {field('startDate', 'Start date')}
                  {field('endDate', 'End date')}
                </div>
              </>
            )}
            <div
              className={creationStyles.currency}
              role="group"
              aria-label="Currency"
            >
              <span>Currency</span>
              <strong>USD · US Dollar</strong>
            </div>
            <p className={creationStyles.note}>
              You can invite others after creating this space.
            </p>
            <div className={creationStyles.actions}>
              <Link href={returnHref ?? '/groups'} scroll={false}>
                Cancel
              </Link>
              <Button type="submit">
                Create {draft.kind === 'TRIP' ? 'trip' : 'group'}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
