'use client';
import { useEffect, useRef, useState } from 'react';
import { readInlineData } from 'relay-runtime';
import type { FinancialScope } from '@/lib/relay/environment';
import type { managementConnectionQuery } from '@/lib/relay/__generated__/managementConnectionQuery.graphql';
import previewDocument, {
  type managementPreviewQuery,
} from '@/lib/relay/__generated__/managementPreviewQuery.graphql';
import impactDocument, {
  type managementImpact$key,
} from '@/lib/relay/__generated__/managementImpact.graphql';
import confirmDocument, {
  type managementConfirmMutation,
} from '@/lib/relay/__generated__/managementConfirmMutation.graphql';
import cancelDocument, {
  type managementCancelMutation,
} from '@/lib/relay/__generated__/managementCancelMutation.graphql';
import recoveryDocument, {
  type managementRecoveryQuery,
} from '@/lib/relay/__generated__/managementRecoveryQuery.graphql';
import currentDocument, {
  type managementCurrentQuery,
} from '@/lib/relay/__generated__/managementCurrentQuery.graphql';
import stagesDocument, {
  type managementStagesQuery,
} from '@/lib/relay/__generated__/managementStagesQuery.graphql';
import archiveDocument, {
  type managementArchiveQuery,
} from '@/lib/relay/__generated__/managementArchiveQuery.graphql';
import { command, readFresh } from './relay-command';
import {
  ManagementRecovery,
  useManagementAttempt,
  managementMessage,
} from './management-attempt';
import { NetworkQuery } from '@/lib/relay/query';
import { Button, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { Enrollment } from './enrollment';
import styles from './personal.module.css';
type Connection = NonNullable<
  managementConnectionQuery['response']['bankingConnection']['connection']
>;
type Request = managementPreviewQuery['variables']['input'];
type Preview = managementPreviewQuery['response']['bankingReplacementPreview'];
/** Format exact signed cents without converting money through binary floating point. */
export function exactUSD(value: string) {
  if (!/^-?\d+$/.test(value)) return 'Unavailable';
  const amount = BigInt(value),
    positive = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}$${(positive / 100n).toLocaleString('en-US')}.${(positive % 100n).toString().padStart(2, '0')} USD`;
}
export function validPostedDate(value: string, today: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '0001-01-01' ||
    value > today
  )
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function Replacement({
  scope,
  connection,
  accountId,
  onBack,
  onChanged,
  onCommitted,
  onDifferent,
  setProviderOpen,
}: {
  setProviderOpen: (open: boolean) => void;
  scope: FinancialScope;
  connection: Connection;
  accountId: string;
  onBack: () => void;
  onDifferent: () => void;
  onChanged: () => void;
  onCommitted: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [intent, setIntent] = useState<'replace' | 'recover' | 'different'>();
  const [action, setAction] = useState<Request['action']>('ACTIVATE');
  const [date, setDate] = useState(''),
    [bindingId, setBinding] = useState('');
  const [preview, setPreview] = useState<{
    request: Request;
    value: Preview;
  }>();
  const [fieldError, setFieldError] = useState('');
  const [archive, setArchive] = useState<string>();
  const [version, setVersion] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const work = useManagementAttempt(scope, () => {
    setConfirmed(true);
    onCommitted();
  });
  const account = connection.accounts.find((a) => a.id === accountId)!;
  const invalidate = () => {
    setPreview(undefined);
    setFieldError('');
  };
  if (confirmed)
    return (
      <>
        <Status kind="info">
          The local change is confirmed. Reload current plans and archive
          status. Provider permission, collection and erased data are not
          restored.
        </Status>
        <Button onClick={onChanged}>Reload current state</Button>
      </>
    );
  return (
    <>
      <h3 ref={heading} tabIndex={-1}>
        {account.name}: replacement and recovery
      </h3>
      <p>
        Prefer repairing the existing connection. Names, masks and similar
        transactions never establish account identity.
      </p>
      <div className={styles.actions}>
        <Button
          tone="secondary"
          disabled={work.busy}
          onClick={() => {
            invalidate();
            setIntent('replace');
            setAction('ACTIVATE');
          }}
        >
          Replace existing
        </Button>
        <Button
          tone="secondary"
          disabled={work.busy}
          onClick={() => {
            invalidate();
            setIntent('different');
          }}
        >
          Different account
        </Button>
        <Button tone="text" disabled={work.busy} onClick={onBack}>
          Cancel
        </Button>
      </div>
      {intent === 'different' && (
        <>
          <p>
            Connect a genuinely different account separately; no existing
            history is reassigned.
          </p>
          <Button tone="secondary" onClick={onDifferent}>
            Return to Connections to connect a different account
          </Button>
        </>
      )}
      {intent === 'replace' && (
        <>
          <p>
            Keep the entire prior reporting history and its annotations through
            a confirmed posted-bank date, inclusive. Only the replacement
            supplies later dates. Staging changes no current totals.
          </p>
          <Enrollment
            scope={scope}
            replacementAccountId={accountId}
            onConnected={onChanged}
            onOverlayChange={setProviderOpen}
          />
          <p>
            After import, reload Connections and select the staged stream below.
            Unusable imports cannot activate.
          </p>
          <Stages
            scope={scope}
            accountId={accountId}
            selected={bindingId}
            onSelect={(id) => {
              setBinding(id);
              invalidate();
            }}
          />
        </>
      )}
      <NetworkQuery<managementRecoveryQuery>
        key={version}
        scope={scope}
        document={recoveryDocument}
        variables={{ filter: { accountIds: [accountId] } }}
        fallback={<ContentLoading label="recovery plans" layout="cards" />}
        failure={
          <Status kind="error">
            Recovery details unavailable.{' '}
            <Button onClick={() => setVersion((v) => v + 1)}>
              Retry recovery details
            </Button>
          </Status>
        }
      >
        {(data) => {
          const report = data.bankingReport;
          if (
            !['READY', 'DATA_UNAVAILABLE', 'DATA_ERROR'].includes(
              report.code,
            ) ||
            !report.asOfDate ||
            !report.accounts.some((a) => a.accountId === accountId)
          )
            return (
              <Status kind="error">
                Recovery details unavailable. Check current access before
                continuing.
              </Status>
            );
          const plan = report.accounts.find((a) => a.accountId === accountId)!;
          return (
            <>
              <p>
                Current transition:{' '}
                {plan.transitionDate ?? 'Original reporting plan'}. Saved plan:{' '}
                {plan.planId ?? 'Original'}. Reporting date today:{' '}
                {report.asOfDate}.
              </p>
              <ul>
                {plan.intervals.map((i, index) => (
                  <li key={`${i.bindingId}:${index}`}>
                    Stream {i.bindingId}: after {i.afterDate ?? 'the beginning'}
                    , through {i.throughDate ?? 'the future'}, inclusive.
                  </li>
                ))}
              </ul>
              <div className={styles.actions}>
                <Button
                  tone="secondary"
                  disabled={work.busy || !plan.transitionDate}
                  onClick={() => {
                    invalidate();
                    setIntent('recover');
                    setAction('CHANGE_BOUNDARY');
                    setDate(plan.transitionDate ?? '');
                  }}
                >
                  Change latest transition date
                </Button>
                <Button
                  tone="secondary"
                  disabled={work.busy || !plan.predecessorId}
                  onClick={() => {
                    invalidate();
                    setIntent('recover');
                    setAction('RESTORE_PREDECESSOR');
                  }}
                >
                  Restore preceding plan
                </Button>
              </div>
              <p>
                Recovery changes reporting only. It does not restore provider
                permission, credentials, account selection, collection or erased
                data. Restored history can remain stale or partial. Rows and
                their latest private annotations leaving reporting remain in the
                noncontributing archive.
              </p>
              <h4>Recovery archives</h4>
              {plan.archives.length ? (
                plan.archives.map((a) => (
                  <div key={a.id} className={styles.account}>
                    <p>
                      Plan {a.planId} · captured boundary {a.boundaryDate} ·{' '}
                      {a.count} records.
                    </p>
                    <Button
                      tone="secondary"
                      onClick={(event) => {
                        archiveTrigger.current = event.currentTarget;
                        setArchive(a.id);
                      }}
                    >
                      View recovery archive — {a.boundaryDate}
                    </Button>
                  </div>
                ))
              ) : (
                <p>No saved recovery archive.</p>
              )}
              {archive && (
                <Archive
                  scope={scope}
                  accountId={accountId}
                  archiveId={archive}
                  today={report.asOfDate}
                  onBack={() => {
                    setArchive(undefined);
                    if (archiveTrigger.current?.isConnected)
                      archiveTrigger.current.focus();
                    else heading.current?.focus();
                  }}
                />
              )}
              {(intent === 'recover' ||
                (intent === 'replace' && bindingId)) && (
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPreview(undefined);
                    if (
                      action !== 'RESTORE_PREDECESSOR' &&
                      !validPostedDate(date, report.asOfDate)
                    ) {
                      setFieldError(
                        'Enter a real posted-bank date no later than today in your saved reporting timezone.',
                      );
                      return;
                    }
                    setFieldError('');
                    const request: Request = {
                      accountId,
                      action,
                      ...(action === 'ACTIVATE' ? { bindingId } : {}),
                      ...(action === 'RESTORE_PREDECESSOR'
                        ? {}
                        : { transitionDate: date }),
                    };
                    void work.run(null, async () => {
                      const value = (
                        await readFresh<managementPreviewQuery>(
                          scope,
                          previewDocument,
                          { input: request },
                        )
                      ).bankingReplacementPreview;
                      if (work.live()) {
                        setPreview({ request, value });
                        if (value.code === 'INVALID_INPUT')
                          setFieldError(
                            'Choose a real nonfuture posted-bank date after the preceding transition boundary.',
                          );
                        else if (value.code !== 'READY')
                          work.setMessage(managementMessage(value.code));
                      }
                      return value.code;
                    });
                  }}
                >
                  <h4>
                    {action === 'RESTORE_PREDECESSOR'
                      ? 'Restore immediately preceding plan'
                      : action === 'CHANGE_BOUNDARY'
                        ? 'Change latest date only'
                        : 'Preview replacement transition'}
                  </h4>
                  {action !== 'RESTORE_PREDECESSOR' && (
                    <label className={styles.field}>
                      Posted-bank transition date D
                      <input
                        type="date"
                        required
                        min="0001-01-01"
                        max={report.asOfDate}
                        value={date}
                        disabled={work.busy}
                        aria-invalid={Boolean(fieldError)}
                        aria-describedby="transition-date-help transition-date-error"
                        onChange={(e) => {
                          setDate(e.target.value);
                          invalidate();
                        }}
                      />
                    </label>
                  )}
                  <p id="transition-date-help">
                    Keep existing history through D, inclusive; use the new
                    connection strictly after D. For repeated transitions D must
                    follow the preceding boundary. Earlier intervals remain
                    intact.
                  </p>
                  {fieldError && (
                    <Status kind="error">
                      <span id="transition-date-error">{fieldError}</span>
                    </Status>
                  )}
                  <Button type="submit" disabled={work.busy}>
                    Preview {action === 'ACTIVATE' ? 'transition' : 'recovery'}
                  </Button>
                </form>
              )}
            </>
          );
        }}
      </NetworkQuery>
      {work.message && <Status kind="info">{work.message}</Status>}
      <ManagementRecovery scope={scope} onChanged={onChanged} />
      {work.busy && <Status kind="pending">Checking reporting plan…</Status>}
      {preview && (
        <section
          aria-label="Transition impact preview"
          className={styles.notice}
        >
          <h4>Reporting impact preview</h4>
          <p>
            {preview.value.code}. Reporting revision{' '}
            {preview.value.reportingRevision ?? 'unavailable'}. Collection:{' '}
            {preview.value.collectionState ?? 'unknown'}.
          </p>
          {preview.value.code === 'READY' && (
            <>
              <Impact title="Current reporting" value={preview.value.prior} />
              <Impact
                title="Proposed reporting"
                value={preview.value.proposed}
              />
              <Impact
                title="Retained current history"
                value={preview.value.retained}
              />
              <Impact title="New current history" value={preview.value.new} />
              <Impact
                title="Leaving reporting for archive"
                value={preview.value.archived}
              />
              <Impact
                title="Replacement overlap excluded"
                value={preview.value.overlap}
              />
              <Impact
                title="Old rows after D"
                value={preview.value.oldAfterBoundary}
              />
              <ul>
                {preview.value.intervals?.map((i, index) => (
                  <li key={index}>
                    Stream {i.bindingId}: after {i.afterDate ?? 'the beginning'}
                    , through {i.throughDate ?? 'the future'} inclusive.
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>
            Coverage: {preview.value.coverage ?? 'unknown'}; known after{' '}
            {preview.value.coverageAfter ?? 'unknown'}, through{' '}
            {preview.value.coverageThrough ?? 'unknown'}. Observed row dates do
            not prove coverage. Similar overlap is not proven duplication;
            changed dates crossing D can leave gaps or differently identified
            duplicates.
          </p>
          <p>
            Historical discrepancies:{' '}
            {preview.value.discrepancyCount ?? 'unknown'}. Retained current
            records keep original IDs and effective private annotations. Archive
            copies add nothing to current totals. No records or annotations are
            fuzzy-matched or reassigned.
          </p>
          <div className={styles.actions}>
            <Button
              disabled={
                work.busy ||
                preview.value.code !== 'READY' ||
                !preview.value.revisions
              }
              onClick={() =>
                void work.run('plan', async (attemptId) => {
                  const expected = preview.value.revisions!;
                  const code = (
                    await command<managementConfirmMutation>(
                      scope,
                      confirmDocument,
                      {
                        input: {
                          attemptId,
                          request: preview.request,
                          expected: {
                            plan: expected.plan,
                            import: expected.import,
                            data: expected.data,
                            annotation: expected.annotation,
                            lifecycle: expected.lifecycle,
                          },
                        },
                      },
                    )
                  ).confirmBankingReplacement.code;
                  if (work.live() && code === 'CONFLICT') setPreview(undefined);
                  return code;
                })
              }
            >
              Confirm{' '}
              {preview.request.action === 'ACTIVATE'
                ? 'transition'
                : 'recovery'}
            </Button>
            {preview.request.action === 'ACTIVATE' && (
              <Button
                tone="secondary"
                disabled={work.busy || !preview.value.revisions}
                onClick={() =>
                  void work.run('plan', async (attemptId) => {
                    const expected = preview.value.revisions!;
                    return (
                      await command<managementCancelMutation>(
                        scope,
                        cancelDocument,
                        {
                          input: {
                            attemptId,
                            request: preview.request,
                            expected: {
                              plan: expected.plan,
                              import: expected.import,
                              data: expected.data,
                              annotation: expected.annotation,
                              lifecycle: expected.lifecycle,
                            },
                          },
                        },
                      )
                    ).cancelBankingReplacement.code;
                  })
                }
              >
                Cancel staged replacement
              </Button>
            )}
            <Button
              tone="text"
              disabled={work.busy}
              onClick={() => setPreview(undefined)}
            >
              Cancel preview
            </Button>
          </div>
          <p>
            Confirmation checks plan, import, source data, annotations and
            lifecycle again. Changed revisions require a fresh preview and
            confirmation. Uncertain outcomes must be recovered before another
            attempt.
          </p>
        </section>
      )}
    </>
  );
}
function Impact({
  title,
  value,
}: {
  title: string;
  value: managementImpact$key | null | undefined;
}) {
  const impact = value ? readInlineData(impactDocument, value) : null;
  return (
    <section>
      <h5>{title}</h5>
      {impact ? (
        <p>
          {impact.count} records · {impact.fromDate ?? 'unknown start'}–
          {impact.throughDate ?? 'unknown end'} ·{' '}
          {exactUSD(impact.spendingMinor)} spending · {impact.annotationCount}{' '}
          annotated · {impact.pendingCount} pending · {impact.unresolvedCount}{' '}
          unresolved. Pending and unresolved records do not contribute spending.
        </p>
      ) : (
        <p>Unavailable</p>
      )}
    </section>
  );
}
function Archive({
  scope,
  accountId,
  archiveId,
  today,
  onBack,
}: {
  scope: FinancialScope;
  accountId: string;
  archiveId: string;
  today: string;
  onBack: () => void;
}) {
  const [after, setAfter] = useState<string | undefined>();
  const [current, setCurrent] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null),
    currentHeading = useRef<HTMLHeadingElement>(null),
    currentTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => heading.current?.focus(), [archiveId]);
  useEffect(() => {
    if (current) currentHeading.current?.focus();
  }, [current]);
  return (
    <section aria-label="Recovery archive">
      <h4 ref={heading} tabIndex={-1}>
        Recovery archive
      </h4>
      <p>
        Immutable snapshots and annotation provenance. Archive-only activity
        contributes nothing to current totals; private edits remain attached to
        their original source. No deleted data can be recovered.
      </p>
      <NetworkQuery<managementArchiveQuery>
        key={after ?? 'first'}
        scope={scope}
        document={archiveDocument}
        variables={{
          filter: {
            accountIds: [accountId],
            archiveId,
            period: 'CUSTOM',
            start: '0001-01-01',
            end: today,
          },
          after,
        }}
        fallback={<ContentLoading label="archive" layout="cards" />}
        failure={
          <Status kind="error">
            Archive unavailable. Return to recovery and reopen it.
          </Status>
        }
      >
        {(data) =>
          data.bankingReport.code !== 'READY' ? (
            <Status kind="error">
              Archive unavailable or changed. Return and reopen with current
              access.
            </Status>
          ) : (
            <>
              <p>
                {data.bankingReport.totalCount} archived records. These records
                are outside current reporting totals.
              </p>
              {data.bankingReport.rows.map((row) => (
                <details key={row.id}>
                  <summary className={styles.link}>
                    {row.bankDate} · {row.name ?? 'Bank activity'} ·{' '}
                    {exactUSD(row.amountMinor)}
                  </summary>
                  <p>
                    Source revision {row.sourceRevision}; latest source revision{' '}
                    {row.latestSourceRevision}. Annotation revision{' '}
                    {row.annotationRevision}.{' '}
                    {row.excluded ? 'Excluded.' : 'Not excluded.'}{' '}
                    {row.discrepancy}.
                  </p>
                  <p>Private note: {row.note ?? 'None'}</p>
                  {row.archives.map((a) => (
                    <p key={a.archiveId}>
                      Archive {a.archiveId}: captured source {a.sourceRevision},
                      annotation cutoff {a.annotationRevision ?? 'none'};
                      captured note {a.annotation?.note ?? 'None'}.
                    </p>
                  ))}
                  {row.currentId && (
                    <Button
                      tone="text"
                      onClick={(event) => {
                        currentTrigger.current = event.currentTarget;
                        setCurrent(row.currentId!);
                      }}
                    >
                      View single current record
                    </Button>
                  )}
                </details>
              ))}
              {data.bankingReport.hasNextPage &&
                data.bankingReport.endCursor && (
                  <Button
                    onClick={() => setAfter(data.bankingReport.endCursor!)}
                  >
                    Next archive page
                  </Button>
                )}
              {after && (
                <Button onClick={() => setAfter(undefined)}>
                  First archive page
                </Button>
              )}
            </>
          )
        }
      </NetworkQuery>
      {current && (
        <section aria-label="Single current record">
          <h4 ref={currentHeading} tabIndex={-1}>
            Single current record
          </h4>
          <NetworkQuery<managementCurrentQuery>
            key={current}
            scope={scope}
            document={currentDocument}
            variables={{ sourceId: current }}
            fallback={<ContentLoading label="current record" layout="cards" />}
            failure={
              <Status kind="error">
                Current record unavailable. Return to archive and retry.
              </Status>
            }
          >
            {(data) =>
              data.bankingTransaction.code === 'READY' &&
              data.bankingTransaction.transaction ? (
                <>
                  <p>
                    {data.bankingTransaction.transaction.bankDate} ·{' '}
                    {data.bankingTransaction.transaction.name ??
                      'Bank activity'}{' '}
                    ·{' '}
                    {exactUSD(data.bankingTransaction.transaction.amountMinor)}
                  </p>
                  <p>
                    Current annotation revision{' '}
                    {data.bankingTransaction.transaction.annotationRevision};
                    source revision{' '}
                    {data.bankingTransaction.transaction.sourceRevision}.
                    Private note:{' '}
                    {data.bankingTransaction.transaction.note ?? 'None'}.
                  </p>
                  <p>
                    This is the single current source. The archive snapshot has
                    no separate editable copy.
                  </p>
                </>
              ) : (
                <Status kind="error">
                  Current record unavailable or no longer current.
                </Status>
              )
            }
          </NetworkQuery>
          <Button
            tone="secondary"
            onClick={() => {
              setCurrent(undefined);
              if (currentTrigger.current?.isConnected)
                currentTrigger.current.focus();
              else heading.current?.focus();
            }}
          >
            Back to recovery archive
          </Button>
        </section>
      )}
      <Button tone="secondary" onClick={onBack}>
        Back to current activity
      </Button>
    </section>
  );
}

function Stages({
  scope,
  accountId,
  selected,
  onSelect,
  after,
}: {
  scope: FinancialScope;
  accountId: string;
  selected: string;
  onSelect: (id: string) => void;
  after?: string;
}) {
  const [more, setMore] = useState(false);
  return (
    <NetworkQuery<managementStagesQuery>
      scope={scope}
      document={stagesDocument}
      variables={{ after }}
      fallback={<ContentLoading label="staged accounts" layout="cards" />}
      failure={
        <Status kind="error">
          Staged accounts unavailable. Reopen management to retry.
        </Status>
      }
    >
      {(data) =>
        data.bankingConnections.code !== 'READY' ? (
          <Status kind="error">
            Staged accounts unavailable. Check current access.
          </Status>
        ) : (
          <fieldset>
            <legend>Staged replacement accounts</legend>
            {data.bankingConnections.connections
              .flatMap((c) => c.accounts)
              .filter(
                (a) =>
                  a.id === accountId &&
                  a.importStatus.reportingState === 'STAGED',
              )
              .map((a) => (
                <label key={a.streamId} className={styles.choice}>
                  <input
                    type="radio"
                    name="replacement-stream"
                    checked={selected === a.streamId}
                    onChange={() => onSelect(a.streamId)}
                  />
                  <span>
                    {a.name} · staged stream {a.streamId}
                  </span>
                </label>
              ))}
            {data.bankingConnections.hasNextPage &&
              data.bankingConnections.endCursor &&
              (more ? (
                <Stages
                  scope={scope}
                  accountId={accountId}
                  selected={selected}
                  onSelect={onSelect}
                  after={data.bankingConnections.endCursor}
                />
              ) : (
                <Button tone="secondary" onClick={() => setMore(true)}>
                  Load more staged accounts
                </Button>
              ))}
          </fieldset>
        )
      }
    </NetworkQuery>
  );
}
