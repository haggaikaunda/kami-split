'use client';
import { createSessionId } from '@/lib/session-id';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readInlineData } from 'relay-runtime';
import type { FinancialScope } from '@/lib/relay/environment';
import detailDocument, {
  type personalTransactionDetail$key,
} from '@/lib/relay/__generated__/personalTransactionDetail.graphql';
import mutationDocument, {
  type personalTransactionAnnotationMutation,
} from '@/lib/relay/__generated__/personalTransactionAnnotationMutation.graphql';
import recoveryDocument, {
  type personalTransactionAnnotationRecoveryQuery,
} from '@/lib/relay/__generated__/personalTransactionAnnotationRecoveryQuery.graphql';
import selectionDocument, {
  type personalTransactionSelectionQuery,
} from '@/lib/relay/__generated__/personalTransactionSelectionQuery.graphql';
import { Button, Dialog, SelectField, Status } from '../ui/primitives';
import { Money } from '../financial/presentation';
import { RestoreSource, ScopedLink } from '../groups/navigation';
import { command, readFresh } from './relay-command';
import { bankMoney, personalHref, readable } from './transaction-state';
import {
  activityChoices,
  annotationError,
  beginEdit,
  changedFields,
  freezeNext,
  loadEdit,
  persistEdit,
  rebaseEdit,
  storageKey,
  type AnnotationField,
  type Edit,
  type Fact,
  type SavedOrigin,
} from './annotation-draft';
import formStyles from '../ui/form-layout.module.css';
import styles from './transaction-detail.module.css';
type Result =
  personalTransactionAnnotationMutation['response']['editBankingAnnotation'];
const categories = [
  'BANK_FEES',
  'ENTERTAINMENT',
  'FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE',
  'GOVERNMENT_AND_NON_PROFIT',
  'HOME_IMPROVEMENT',
  'INCOME',
  'LOAN_PAYMENTS',
  'LOAN_DISBURSEMENTS',
  'MEDICAL',
  'PERSONAL_CARE',
  'GENERAL_SERVICES',
  'RENT_AND_UTILITIES',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'TRANSPORTATION',
  'TRAVEL',
  'OTHER',
  'UNCATEGORIZED',
];
function factFrom(result: Result): Fact | null {
  return result.detail?.code === 'READY' && result.detail.transaction
    ? readInlineData<personalTransactionDetail$key>(
        detailDocument,
        result.detail.transaction,
      )
    : null;
}
/** A draft is an intentional user-owned revision baseline, never a second live store. */
export function TransactionDetail({
  scope,
  transaction,
  archive,
  discrepancy,
  names,
  onSaved,
  onFieldSaved,
  originPages,
  focusEdit = false,
  onFocusedEdit,
}: {
  scope: FinancialScope;
  transaction: personalTransactionDetail$key;
  archive: string | null;
  discrepancy: boolean;
  names: ReadonlyMap<string, string>;
  onSaved: () => void;
  onFieldSaved: (origin?: SavedOrigin) => void;
  originPages: number;
  focusEdit?: boolean;
  onFocusedEdit?: () => void;
}) {
  const fact = readInlineData<personalTransactionDetail$key>(
    detailDocument,
    transaction,
  );
  const router = useRouter(),
    params = useSearchParams();
  const [initial] = useState(() => {
    try {
      return {
        edit:
          discrepancy || (archive && fact.currentId)
            ? null
            : loadEdit(scope.actor, fact.sourceId),
        error: '',
      };
    } catch {
      return {
        edit: null,
        error:
          'The saved draft is unavailable. Restore tab storage access before editing.',
      };
    }
  });
  const [edit, setEdit] = useState<Edit | null>(initial.edit);
  const [fresh, setFresh] = useState<Fact | null>(null);
  const [conflict, setConflict] = useState(
    Boolean(
      initial.edit &&
      !initial.edit.pending &&
      (initial.edit.requiresReview ||
        initial.edit.sourceRevision !== fact.sourceRevision ||
        initial.edit.annotationRevision !== fact.annotationRevision),
    ),
  );
  const [message, setMessage] = useState(
    initial.error ||
      (initial.edit?.pending
        ? 'The original save is unconfirmed. Check its result before sending anything else.'
        : initial.edit?.requiresReview
          ? 'Newer saved changes need review. Check the current record before reapplying your remaining input.'
          : ''),
  );
  const [storageError, setStorageError] = useState(Boolean(initial.error));
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState<'close' | 'cancel' | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null),
    editButton = useRef<HTMLButtonElement>(null),
    wasEditing = useRef(false);
  const editing = !!edit;
  const consumeSavedFocus = useEffectEvent(() => onFocusedEdit?.());
  useEffect(() => {
    const target = editing
      ? editorHeading.current
      : wasEditing.current || focusEdit
        ? editButton.current
        : null;
    wasEditing.current = editing;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
    if (target && !editing && focusEdit) consumeSavedFocus();
  }, [editing, focusEdit]);
  const alive = useRef(true),
    locked = useRef(false);
  const live = () => alive.current && scope.isLive();
  const dirty = !!edit && (changedFields(edit).length > 0 || !!edit.pending);
  const token = params.get('source');
  const visit =
    token && scope.isLive()
      ? (scope.visits.get(token) ?? initial.edit?.returnTo)
      : undefined;
  const origin = visit
    ? new URL(visit.href, 'https://workspace.invalid')
    : null;
  const backLabel = origin?.searchParams.has('archive')
    ? 'Back to recovery archive'
    : origin?.searchParams.get('tab') === 'overview'
      ? 'Back to Overview'
      : 'Back to transactions';
  const close = () => {
    if (!scope.isLive()) return;
    if (origin && token) {
      if (visit) scope.visits.set(token, visit);
      origin.searchParams.set('restore', token);
      scope.restored.delete(token);
      router.replace(origin.pathname + origin.search, { scroll: false });
    } else
      router.replace(
        personalHref(new URLSearchParams(params), { transaction: null }),
        { scroll: false },
      );
  };
  const requestClose = () => (dirty ? setDiscard('close') : close());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const historyExit = useEffectEvent(() => setDiscard('close'));
  // Own dirty navigation before the route can dispose this draft. The native
  // navigation boundary preserves history; older engines use a guarded entry.
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', unload);
    // Cancel browser traversal before a URL/history commit. This preserves Next's
    // own history entries and lets the user explicitly choose discard or continue.
    if (window.navigation) {
      const navigate = (event: NavigateEvent) => {
        if (
          event.navigationType !== 'traverse' ||
          !event.cancelable ||
          !scope.isLive()
        )
          return;
        event.preventDefault();
        historyExit();
      };
      window.navigation.addEventListener('navigate', navigate);
      return () => {
        window.navigation.removeEventListener('navigate', navigate);
        window.removeEventListener('beforeunload', unload);
      };
    }
    const marker = createSessionId(),
      href = window.location.href;
    window.history.pushState(
      { ...window.history.state, annotationGuard: marker },
      '',
      href,
    );
    const back = (event: PopStateEvent) => {
      if (!scope.isLive()) return;
      event.stopImmediatePropagation();
      window.history.pushState(
        { ...window.history.state, annotationGuard: marker },
        '',
        href,
      );
      historyExit();
    };
    window.addEventListener('popstate', back, true);
    return () => {
      window.removeEventListener('popstate', back, true);
      window.removeEventListener('beforeunload', unload);
      // Keep the current URL and Next state while retiring our private marker.
      if (window.history.state?.annotationGuard === marker) {
        const state = { ...window.history.state };
        delete state.annotationGuard;
        window.history.replaceState(state, '', href);
      }
    };
  }, [dirty, scope]);
  const retain = (next: Edit) => {
    setEdit(next);
    try {
      persistEdit(next);
      setStorageError(false);
    } catch {
      setStorageError(true);
      setMessage(
        'Tab storage is unavailable. Your input is kept here; restore storage before saving.',
      );
    }
  };
  const clear = () => {
    try {
      sessionStorage.removeItem(storageKey(scope.actor, fact.sourceId));
    } catch {
      setStorageError(true);
      setMessage(
        'Tab storage could not be cleared. Your draft remains; restore storage before continuing.',
      );
      return false;
    }
    setEdit(null);
    setConflict(false);
    setFresh(null);
    setMessage('');
    return true;
  };
  const act = async (action: () => Promise<void>) => {
    if (locked.current || !live()) return;
    locked.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      if (live())
        setMessage(
          'The save or read could not be confirmed. Your intended input is preserved. Check the original save before retrying.',
        );
    } finally {
      locked.current = false;
      if (live()) setBusy(false);
    }
  };
  const accept = (result: Result, sent: Edit): Edit | null => {
    if (!live()) return null;
    const current = factFrom(result);
    if (result.code === 'NOT_FOUND') {
      setUnavailable(true);
      return null;
    }
    if (result.code === 'READY' && !current) {
      onFieldSaved(sent.returnTo);
      setUnavailable(true);
      setMessage(
        'The original field save is confirmed, but the current private record is unavailable. No further change was sent.',
      );
      return null;
    }
    if (result.code === 'READY' && current) {
      onFieldSaved(sent.returnTo);
      const next = rebaseEdit(sent, current);
      // Only this operation's field is confirmed. Other intended values remain.
      const field = sent.pending!.field as AnnotationField;
      next.draft[field] = next.baseline[field];
      if (field === 'ACTIVITY') delete next.confirmActivity;
      const bankChanged =
        current.sourceRevision !== sent.sourceRevision ||
        current.materialRevision !== sent.materialRevision;
      const interveningPrivateEdit =
        BigInt(current.annotationRevision) !==
        BigInt(sent.pending!.expectedRevision) + 1n;
      if (bankChanged || interveningPrivateEdit) {
        next.requiresReview = true;
        retain(next);
        setConflict(true);
        setFresh(current);
        setMessage(
          bankChanged
            ? 'The field save is confirmed, but bank facts changed. Remaining changes need explicit review and reapplication.'
            : 'The field save is confirmed, but newer private changes were saved elsewhere. Remaining input needs explicit review and reapplication.',
        );
        return null;
      }
      retain(next);
      setConflict(false);
      setFresh(null);
      return next;
    }
    if (
      [
        'CONFLICT',
        'INVALID_INPUT',
        'NOT_FOUND',
        'IDEMPOTENCY_CONFLICT',
      ].includes(result.code)
    ) {
      const next = { ...sent, requiresReview: true };
      delete next.pending;
      retain(next);
      setConflict(true);
      setFresh(current);
      setMessage(
        result.code === 'CONFLICT'
          ? 'The source or private annotation changed. Your remaining input is preserved. Check the current record before reapplying.'
          : result.code === 'INVALID_INPUT'
            ? 'The server rejected a private value. Your remaining input is preserved; check the current record and correct it.'
            : 'This record or operation is unavailable. Check current access; no new save is allowed.',
      );
      return null;
    }
    setMessage(
      'The original save is unconfirmed. Check its result before sending anything else.',
    );
    return null;
  };
  const finish = () => {
    if (token && edit?.returnTo) scope.visits.set(token, edit.returnTo);
    if (!clear()) {
      setMessage(
        'Private changes are confirmed, but tab storage cleanup failed. Restore storage before editing again.',
      );
      return;
    }
    setMessage(
      'Private changes saved. Complete activity totals are being checked separately.',
    );
    onSaved();
  };
  const withArchiveDetail = async (result: Result): Promise<Result> => {
    if (result.code !== 'READY' || factFrom(result) || !archive) return result;
    const detail = (
      await readFresh<personalTransactionSelectionQuery>(
        scope,
        selectionDocument,
        { source: fact.sourceId, archive },
      )
    ).bankingTransaction;
    return { ...result, detail };
  };
  const save = async () => {
    if (!edit || edit.pending || conflict || storageError) return;
    const error = annotationError(edit, fresh ?? fact);
    if (error) {
      setMessage(error);
      return;
    }
    let next: Edit | null = edit;
    while (next && changedFields(next).length && live()) {
      next = freezeNext(next);
      // Persist the exact attempt before the first possible server effect.
      try {
        persistEdit(next);
      } catch {
        setStorageError(true);
        setMessage(
          'Tab storage is unavailable. No new field was sent. Restore storage before saving.',
        );
        return;
      }
      setEdit(next);
      const result = (
        await command<personalTransactionAnnotationMutation>(
          scope,
          mutationDocument,
          { input: next.pending! },
        )
      ).editBankingAnnotation;
      next = accept(await withArchiveDetail(result), next);
    }
    if (next && live()) finish();
  };
  const recover = async () => {
    if (!edit?.pending) return;
    let result = (
      await readFresh<personalTransactionAnnotationRecoveryQuery>(
        scope,
        recoveryDocument,
        { attemptId: edit.pending.attemptId },
      )
    ).bankingAnnotationOperation;
    if (result.code === 'NOT_FOUND') {
      // A missing receipt may precede an in-flight write. Replay only frozen input.
      result = (
        await command<personalTransactionAnnotationMutation>(
          scope,
          mutationDocument,
          { input: edit.pending },
        )
      ).editBankingAnnotation;
    }
    const next = accept(await withArchiveDetail(result), edit);
    if (next && live()) {
      if (!changedFields(next).length) finish();
      else
        setMessage(
          'Original field save confirmed. Other changes are still unsaved; review and Save changes to continue.',
        );
    }
  };
  const checkCurrent = async () => {
    const result = (
      await readFresh<personalTransactionSelectionQuery>(
        scope,
        selectionDocument,
        {
          source: fact.sourceId,
          archive: archive && !fact.currentId ? archive : null,
        },
      )
    ).bankingTransaction;
    if (!live()) return;
    if (result.code !== 'READY' || !result.transaction) {
      setUnavailable(true);
      setFresh(null);
      setMessage(
        'This private record is unavailable or no longer accessible. Your input is preserved.',
      );
      return;
    }
    setFresh(
      readInlineData<personalTransactionDetail$key>(
        detailDocument,
        result.transaction,
      ),
    );
    setMessage(
      'Current bank facts and saved private values are shown below. Review them before explicitly reapplying your remaining input.',
    );
  };
  const change = (field: AnnotationField, value: string | null) => {
    if (edit && !busy && !edit.pending && !conflict)
      retain({ ...edit, draft: { ...edit.draft, [field]: value } });
  };
  const editable = !discrepancy && !(archive && fact.currentId);
  if (unavailable)
    return (
      <Dialog open title="Transaction detail" panel onClose={close}>
        <Status kind="error">
          {message ||
            'This private record is unavailable or no longer accessible.'}
        </Status>
        <Button onClick={close}>{backLabel}</Button>
      </Dialog>
    );
  return (
    <Dialog open title="Transaction detail" panel onClose={requestClose}>
      <div className={styles.detail} data-source-id={fact.sourceId}>
        <RestoreSource scope={scope} allowed={[]} />
        <div className={styles.top}>
          <Button tone="text" onClick={requestClose}>
            {backLabel}
          </Button>
          <span>Only you</span>
        </div>
        <h3>{fact.merchantName || fact.name || 'Bank transaction'}</h3>
        <div className={styles.amount}>
          <Money value={bankMoney(fact.amountMinor)} currency={fact.currency} />
        </div>
        <p>
          {BigInt(fact.amountMinor) < 0n ? 'Money in' : 'Money out'} ·{' '}
          {readable(fact.processingState)}
          {edit && <> · {fact.bankDate}</>}
        </p>
        {!edit && (
          <dl className={styles.facts}>
            <div>
              <dt>Account</dt>
              <dd>{names.get(fact.accountId) ?? 'Retained bank account'}</dd>
            </div>
            <div>
              <dt>
                {fact.processingState === 'pending'
                  ? 'Provisional bank date'
                  : 'Posted bank date'}
              </dt>
              <dd>{fact.bankDate}</dd>
            </div>
            {fact.authorizationDate && (
              <div>
                <dt>Authorization date</dt>
                <dd>{fact.authorizationDate}</dd>
              </div>
            )}
            <div>
              <dt>Activity type</dt>
              <dd>
                {readable(fact.activity)}
                {fact.activityOverride && ' · Private override'}
              </dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>
                {readable(fact.category)}
                {fact.categoryOverride && ' · Private override'}
              </dd>
            </div>
            <div>
              <dt>Spending</dt>
              <dd>
                {fact.eligible ? 'Included' : 'Not included'}
                {fact.excluded && ' · Excluded privately'}
              </dd>
            </div>
            <div>
              <dt>Review status</dt>
              <dd>{fact.reviewed ? 'Reviewed' : 'Needs review'}</dd>
            </div>
            <div>
              <dt>Private note</dt>
              <dd className={styles.note}>{fact.note || 'No private note'}</dd>
            </div>
          </dl>
        )}
        {fact.processingState !== 'posted' && (
          <Status kind="info">
            {fact.processingState === 'pending'
              ? 'Pending amount and provisional date may change when posted.'
              : 'Removed bank history remains available for inspection.'}{' '}
            This record contributes nothing to spending.
          </Status>
        )}
        {(fact.materialConflict || fact.activity === 'unresolved') && (
          <Status kind="info">
            Classification needs review. A reviewed flag alone does not resolve
            unknown activity. Confirm a compatible activity type; unresolved
            activity is separate from spending.
          </Status>
        )}
        {!fact.current && (
          <Status kind="info">
            Archive-only history. Private edits affect no current totals unless
            this source is explicitly restored. Restoration uses the latest
            valid annotations.
          </Status>
        )}
        {fact.discrepancy !== 'none' && (
          <Status kind="info">
            Historical discrepancy: latest bank facts differ from retained
            reporting. Date changes can leave gaps or differently identified
            duplicates.
          </Status>
        )}
        {archive && fact.currentId && (
          <ScopedLink
            scope={scope}
            id={`selected-current-${fact.sourceId}`}
            href={personalHref(new URLSearchParams(params), {
              transaction: fact.currentId,
              source: null,
              archive: null,
              discrepancies: null,
            })}
          >
            View current record
          </ScopedLink>
        )}
        {message && (
          <Status
            kind={conflict || edit?.pending || storageError ? 'error' : 'info'}
          >
            {message}
          </Status>
        )}
        {storageError && (
          <Button
            disabled={busy}
            onClick={() => {
              try {
                if (edit) persistEdit(edit);
                else
                  sessionStorage.removeItem(
                    storageKey(scope.actor, fact.sourceId),
                  );
                setStorageError(false);
                setMessage(
                  'Draft storage is available. Review your private input before saving.',
                );
              } catch {
                setMessage(
                  'Tab storage remains unavailable. No new change was sent.',
                );
              }
            }}
          >
            {edit ? 'Retry draft storage' : 'Discard unavailable draft'}
          </Button>
        )}
        {!edit && editable && (
          <Button
            ref={editButton}
            disabled={storageError}
            onClick={() => {
              setMessage('');
              retain({
                ...beginEdit(scope.actor, fact),
                ...(visit
                  ? {
                      returnTo: {
                        href: visit.href,
                        focus: visit.focus,
                        scroll: visit.scroll,
                        pages:
                          'pages' in visit && typeof visit.pages === 'number'
                            ? visit.pages
                            : originPages,
                      },
                    }
                  : {}),
              });
            }}
          >
            Edit
          </Button>
        )}
        {edit && (
          <form
            className={formStyles['form-scope']}
            onSubmit={(event) => {
              event.preventDefault();
              void act(save);
            }}
          >
            <h3
              ref={editorHeading}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Tab' ||
                  event.shiftKey ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey
                )
                  return;
                const first = event.currentTarget
                  .closest('form')
                  ?.querySelector<HTMLElement>(
                    'select:not(:disabled), input:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
                  );
                if (first) {
                  event.preventDefault();
                  event.stopPropagation();
                  first.focus();
                }
              }}
            >
              Edit private annotations
            </h3>
            <p>
              These changes stay private. Bank amount and dates stay unchanged.
            </p>
            <fieldset
              className={styles.fields}
              disabled={busy || !!edit.pending || conflict || storageError}
            >
              <SelectField
                label="Activity type"
                value={edit.draft.ACTIVITY ?? ''}
                onChange={(event) =>
                  change('ACTIVITY', event.target.value || null)
                }
              >
                <option value="">Bank derived activity</option>
                {[
                  ...new Set([
                    ...activityChoices((fresh ?? fact).amountMinor),
                    ...(edit.draft.ACTIVITY ? [edit.draft.ACTIVITY] : []),
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {readable(value)}
                  </option>
                ))}
              </SelectField>
              <Button tone="text" onClick={() => change('ACTIVITY', null)}>
                Reset activity type
              </Button>
              {fact.materialConflict && edit.draft.ACTIVITY && (
                <Button
                  tone="secondary"
                  onClick={() => retain({ ...edit, confirmActivity: true })}
                >
                  Confirm activity type
                </Button>
              )}
              <SelectField
                label="Category"
                value={edit.draft.CATEGORY ?? ''}
                onChange={(event) =>
                  change('CATEGORY', event.target.value || null)
                }
              >
                <option value="">Bank derived category</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {readable(value)}
                  </option>
                ))}
              </SelectField>
              <Button tone="text" onClick={() => change('CATEGORY', null)}>
                Reset category
              </Button>
              <label data-ui="form-label" htmlFor="private-transaction-note">
                Private note
              </label>
              <textarea
                id="private-transaction-note"
                data-ui="form-control"
                rows={4}
                value={edit.draft.NOTE ?? ''}
                onChange={(event) => change('NOTE', event.target.value || null)}
                aria-describedby="private-note-limit"
              />
              <p id="private-note-limit">
                Plain text, up to 2,000 characters. Line breaks and tabs are
                allowed.
              </p>
              <Button tone="text" onClick={() => change('NOTE', null)}>
                Reset private note
              </Button>
              <label className={styles.check}>
                <input
                  data-ui="form-checkbox"
                  type="checkbox"
                  checked={edit.draft.EXCLUDED === 'true'}
                  onChange={(event) =>
                    change('EXCLUDED', String(event.target.checked))
                  }
                />
                Exclude from spending
              </label>
              <Button tone="text" onClick={() => change('EXCLUDED', null)}>
                Reset exclusion
              </Button>
              <label className={styles.check}>
                <input
                  data-ui="form-checkbox"
                  type="checkbox"
                  checked={edit.draft.REVIEWED === 'true'}
                  onChange={(event) =>
                    change('REVIEWED', String(event.target.checked))
                  }
                />
                Reviewed
              </label>
              <Button tone="text" onClick={() => change('REVIEWED', null)}>
                Reset reviewed status
              </Button>
            </fieldset>
            {annotationError(edit, fresh ?? fact) && (
              <Status kind="error">
                {annotationError(edit, fresh ?? fact)}
              </Status>
            )}
            <p>
              Each changed field saves separately. Confirmed fields stay saved
              if a later field fails. No shared expense is created.
            </p>
            <div className={styles.actions}>
              <Button
                tone="secondary"
                disabled={busy || !!edit.pending}
                onClick={() => (dirty ? setDiscard('cancel') : clear())}
              >
                Cancel editing
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !!edit.pending ||
                  conflict ||
                  storageError ||
                  !changedFields(edit).length ||
                  !!annotationError(edit, fresh ?? fact)
                }
              >
                Save changes
              </Button>
            </div>
            {edit.pending && (
              <Button disabled={busy} onClick={() => void act(recover)}>
                Check original save
              </Button>
            )}
            {conflict && (
              <>
                <Button disabled={busy} onClick={() => void act(checkCurrent)}>
                  Check current record
                </Button>
                {fresh && (
                  <div className={styles.current}>
                    <h3>Current saved record</h3>
                    <p>
                      {bankMoney(fresh.amountMinor)} {fresh.currency} ·{' '}
                      {fresh.bankDate} · {readable(fresh.processingState)} ·{' '}
                      {readable(fresh.activity)} · {readable(fresh.category)}
                    </p>
                    <p className={styles.note}>
                      {fresh.note || 'No private note'} ·{' '}
                      {fresh.excluded ? 'Excluded' : 'Included when eligible'} ·{' '}
                      {fresh.reviewed ? 'Reviewed' : 'Needs review'}
                    </p>
                    <Button
                      disabled={busy || !editable}
                      onClick={() => {
                        retain(rebaseEdit(edit, fresh));
                        setConflict(false);
                        setFresh(null);
                        setMessage(
                          'Current versions adopted. Your remaining input is kept; review and Save changes to reapply it.',
                        );
                      }}
                    >
                      Use current versions
                    </Button>
                  </div>
                )}
              </>
            )}
          </form>
        )}
        {archive && (
          <section>
            <h3>Immutable archive provenance</h3>
            {fact.archives
              .filter((item) => item.archiveId === archive)
              .map((item) => (
                <div key={item.archiveId}>
                  <p>
                    Captured source revision {item.sourceRevision}; annotation
                    revision {item.annotationRevision ?? 'none'}.
                  </p>
                  <p className={styles.note}>
                    Captured note: {item.annotation?.note ?? 'None'}. Category:{' '}
                    {item.annotation?.category ?? 'Bank derived'}. Activity:{' '}
                    {item.annotation?.activity ?? 'Bank derived'}.{' '}
                    {item.annotation?.excluded
                      ? 'Excluded'
                      : 'Included when eligible'}{' '}
                    · {item.annotation?.reviewed ? 'Reviewed' : 'Not reviewed'}.
                  </p>
                </div>
              ))}
          </section>
        )}
        <details>
          <summary>Original bank details</summary>
          <dl className={styles.facts}>
            {[
              ['Account', names.get(fact.accountId) ?? 'Retained bank account'],
              [
                fact.processingState === 'pending'
                  ? 'Provisional bank date'
                  : 'Posted bank date',
                fact.bankDate,
              ],
              ...(fact.authorizationDate
                ? [['Authorization date', fact.authorizationDate]]
                : []),
              ['Description', fact.name],
              ['Provider category', fact.providerCategory],
              ['Provider primary category', fact.providerPrimaryCategory],
              ['Provider confidence', fact.providerConfidence],
              ['Provider transaction code', fact.providerCode],
              ['Mapping version', fact.mappingVersion],
              ['Source identity', fact.sourceId],
              ['Source revision', fact.sourceRevision],
              ['Latest source revision', fact.latestSourceRevision],
              ['Annotation revision', fact.annotationRevision],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || 'Not supplied'}</dd>
              </div>
            ))}
          </dl>
        </details>
        <p className={styles.privacy}>
          Only you can see these details. Refunds reduce their posting period.
          Income, transfers, repayments and cash withdrawals stay separate from
          spending.
        </p>
        {discard && (
          <Dialog
            open
            title="Discard unsaved changes?"
            onClose={() => setDiscard(null)}
          >
            <p>
              Your intended input is kept until you discard it. Confirmed field
              saves cannot be undone by discarding.
            </p>
            {edit?.pending && (
              <p>
                The original save is unconfirmed. Leaving keeps its frozen
                attempt for recovery when you return.
              </p>
            )}
            <div className={styles.actions}>
              <Button onClick={() => setDiscard(null)}>Keep editing</Button>
              <Button
                tone="danger"
                disabled={busy}
                onClick={() => {
                  const destination = discard;
                  setDiscard(null);
                  if (!edit?.pending && !clear()) return;
                  if (destination === 'close') close();
                }}
              >
                Discard changes
              </Button>
            </div>
          </Dialog>
        )}
      </div>
    </Dialog>
  );
}
