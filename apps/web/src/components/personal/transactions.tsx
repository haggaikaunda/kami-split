'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFragment } from 'react-relay';
import type { FinancialScope } from '@/lib/relay/environment';
import { NetworkQuery } from '@/lib/relay/query';
import reportDocument, {
  type personalTransactionsQuery,
} from '@/lib/relay/__generated__/personalTransactionsQuery.graphql';
import rowDocument, {
  type personalTransactionRow$key,
} from '@/lib/relay/__generated__/personalTransactionRow.graphql';
import selectionDocument, {
  type personalTransactionSelectionQuery,
} from '@/lib/relay/__generated__/personalTransactionSelectionQuery.graphql';
import { Button, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { Money } from '../financial/presentation';
import { RestoreSource, ScopedLink, SourceReturn } from '../groups/navigation';
import { TransactionControls } from './transaction-controls';
import {
  bankMoney,
  personalHref,
  readable,
  reportFilter,
  transactionSelection,
} from './transaction-state';
import styles from './transactions.module.css';
type Report = personalTransactionsQuery['response']['bankingReport'];
type Context = { scope: FinancialScope; names: ReadonlyMap<string, string> };
export function PersonalTransactions({ scope, names }: Context) {
  const params = useSearchParams();
  const filter = reportFilter(new URLSearchParams(params));
  const identity = JSON.stringify(filter);
  return (
    <TransactionRead
      key={`${scope.id}:${identity}`}
      scope={scope}
      names={names}
      filter={filter}
    />
  );
}
function TransactionRead({
  scope,
  names,
  filter,
}: Context & { filter: personalTransactionsQuery['variables']['filter'] }) {
  const [version, setVersion] = useState(0),
    [restart, setRestart] = useState(false);
  const retry = () => {
    setRestart(false);
    setVersion((value) => value + 1);
  };
  return (
    <section className={styles.transactions} aria-label="Private transactions">
      {restart ? (
        <Status kind="info">
          Activity changed while paging. Restart to read one consistent result;
          your dates and filters are preserved.{' '}
          <Button tone="text" onClick={retry}>
            Restart activity
          </Button>
        </Status>
      ) : (
        <NetworkQuery<personalTransactionsQuery>
          key={version}
          document={reportDocument}
          scope={scope}
          variables={{ filter }}
          fallback={
            <ContentLoading layout="expenses" label="private transactions" />
          }
          failure={
            <Status kind="error">
              Private activity could not be loaded. No total is confirmed.{' '}
              <Button tone="text" onClick={retry}>
                Retry activity
              </Button>
            </Status>
          }
        >
          {(data) => (
            <ReportContent
              scope={scope}
              names={names}
              report={data.bankingReport}
              filter={filter}
              onRestart={() => setRestart(true)}
              onRetry={retry}
            />
          )}
        </NetworkQuery>
      )}
    </section>
  );
}
function ReportContent({
  scope,
  names,
  report,
  filter,
  onRestart,
  onRetry,
}: Context & {
  report: Report;
  filter: personalTransactionsQuery['variables']['filter'];
  onRestart: () => void;
  onRetry: () => void;
}) {
  const params = useSearchParams(),
    selection = transactionSelection(params);
  useEffect(() => {
    if (report.code !== 'READY' || !report.timezone) return;
    const timer = window.setInterval(() => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: report.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      const date = ['year', 'month', 'day']
        .map((type) => parts.find((part) => part.type === type)?.value)
        .join('-');
      if (date !== report.asOfDate) onRetry();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [report.code, report.timezone, report.asOfDate, onRetry]);
  const connections = personalHref(new URLSearchParams(params), {
    tab: 'connections',
    transaction: null,
  });
  return (
    <>
      <TransactionControls
        start={report.start}
        end={report.end}
        today={report.asOfDate}
        timezone={report.timezone}
        accounts={report.accounts}
        names={names}
        activities={report.activityChoices}
        categories={report.categoryChoices}
      />
      {report.code !== 'READY' ? (
        <Status kind="error">
          {reportProblem(report.code)}{' '}
          {report.fieldErrors.length > 0 &&
            `Check: ${report.fieldErrors.join(', ')}.`}{' '}
          <Button tone="text" onClick={onRetry}>
            Retry activity
          </Button>{' '}
          <Link href={connections}>Go to Connections</Link>
        </Status>
      ) : (
        <>
          <RestoreSource scope={scope} allowed={[]} />
          {selection.source ? (
            <SelectedTransaction scope={scope} names={names} />
          ) : (
            <>
              {selection.archive && (
                <div className={styles.notice}>
                  <h2>Recovery archive</h2>
                  <p>
                    Captured history and annotations. These copies contribute
                    nothing to current activity, counts or spending.
                  </p>
                  {params.get('source') &&
                    scope.visits.has(params.get('source')!) && (
                      <SourceReturn
                        scope={scope}
                        fallbackLabel="Back to current activity"
                      />
                    )}
                  <Link
                    href={personalHref(new URLSearchParams(params), {
                      archive: null,
                      transaction: null,
                      discrepancies: null,
                    })}
                  >
                    Back to current activity
                  </Link>
                </div>
              )}
              {selection.discrepancy && (
                <div className={styles.notice}>
                  <h2>Source discrepancies</h2>
                  <p>
                    Latest source changes are shown separately. They do not
                    replace retained canonical facts or contribute to spending.
                    A date crossing the transition can leave a gap or
                    differently identified duplicate.
                  </p>
                  <Link
                    href={personalHref(new URLSearchParams(params), {
                      discrepancies: null,
                      transaction: null,
                    })}
                  >
                    Back to current activity
                  </Link>
                </div>
              )}
              <Coverage
                report={report}
                names={names}
                connections={connections}
              />
              {report.summary && (
                <p className={styles.summary}>
                  Spending from your accounts:{' '}
                  <strong>
                    <Money
                      value={bankMoney(report.summary.netMinor)}
                      currency="USD"
                    />
                  </strong>
                  <span>
                    Purchases &amp; charges{' '}
                    {bankMoney(report.summary.purchaseMinor)} − refunds{' '}
                    {bankMoney(report.summary.refundMinor)}. Refunds reduce
                    their posting period.
                  </span>
                  {!report.summary.classificationComplete && (
                    <span>
                      Classification incomplete. Unresolved activity is separate
                      from this subtotal.
                    </span>
                  )}
                </p>
              )}
              <div className={styles.listMeta}>
                <h2>
                  {selection.archive
                    ? 'Captured account activity'
                    : selection.discrepancy
                      ? 'Changed source activity'
                      : 'Account activity'}
                </h2>
                <span>
                  {report.totalCount} transactions · complete matching count
                </span>
              </div>
              {report.counts && (
                <p className={styles.context}>
                  {report.counts.pendingCount} pending ·{' '}
                  {report.counts.unresolvedCount} unresolved ·{' '}
                  {report.counts.count - report.counts.reviewedCount} not
                  reviewed · {report.counts.excludedCount} excluded ·{' '}
                  {report.counts.removedCount} removed
                  {!report.summary &&
                    ' · Activity context; no spending total applies.'}
                </p>
              )}
              {!report.rows.length ? (
                <div className={styles.empty}>
                  <h3>No matching transactions</h3>
                  <p>
                    {report.accounts.length &&
                    report.accounts.every(
                      (account) => account.coverage === 'COMPLETE',
                    )
                      ? 'No activity matches these dates and filters in the covered history.'
                      : 'No matching imported activity. History coverage is incomplete or unknown; this is not confirmation of zero spending.'}
                  </p>
                </div>
              ) : (
                <TransactionPage
                  scope={scope}
                  names={names}
                  report={report}
                  filter={filter}
                  onRestart={onRestart}
                />
              )}
              <details className={styles.provenance}>
                <summary>Reporting history and recovery archives</summary>
                {report.accounts.map((account) => (
                  <div key={account.accountId}>
                    <h3>
                      {names.get(account.accountId) ??
                        `Retained ${readable(account.kind)} account`}
                    </h3>
                    {account.transitionDate && (
                      <p>
                        Retained canonical history through{' '}
                        {account.transitionDate} inclusive; replacement activity
                        strictly after the boundary. Each interval keeps its
                        original source identity and annotations.
                      </p>
                    )}
                    {account.intervals.map((interval) => (
                      <p key={interval.bindingId}>
                        Reporting interval: after{' '}
                        {interval.afterDate ??
                          'the beginning of retained history'}{' '}
                        through {interval.throughDate ?? 'the current period'}.{' '}
                        {interval.discrepancyCount > 0 &&
                          `${interval.discrepancyCount} historical discrepancies.`}
                      </p>
                    ))}
                    {account.archives.map((archive) => (
                      <p key={archive.id}>
                        <ScopedLink
                          scope={scope}
                          id={`archive-${archive.id}`}
                          href={personalHref(new URLSearchParams(params), {
                            archive: archive.id,
                            discrepancies: null,
                            transaction: null,
                          })}
                        >
                          View recovery archive · through {archive.boundaryDate}{' '}
                          · {archive.count} records · plan {archive.planId}
                        </ScopedLink>
                      </p>
                    ))}
                  </div>
                ))}
                {!selection.archive && (
                  <ScopedLink
                    scope={scope}
                    id="source-discrepancies"
                    href={personalHref(new URLSearchParams(params), {
                      discrepancies: 'true',
                      archive: null,
                      transaction: null,
                    })}
                  >
                    Inspect source discrepancies
                  </ScopedLink>
                )}
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}
function Coverage({
  report,
  names,
  connections,
}: {
  report: Report;
  names: ReadonlyMap<string, string>;
  connections: string;
}) {
  return (
    <div className={styles.coverage}>
      {report.accounts.map((account) => (
        <div key={account.accountId}>
          <p>
            <strong>
              {names.get(account.accountId) ??
                `Retained ${readable(account.kind)} account`}
            </strong>{' '}
            · {readable(account.coverage)} coverage
            {!account.selected && ' · Updates stopped; retained history'}
            {account.coverage !== 'COMPLETE' &&
              '. Selected dates are preserved; earlier or recent activity may be missing.'}
          </p>
          {account.intervals.some(
            (interval) =>
              interval.collectionStopped ||
              !['usable'].includes(interval.importState) ||
              interval.discrepancyCount > 0,
          ) && (
            <p>
              Import or connection needs attention; retained activity can be
              incomplete, stale or corrected.{' '}
              <Link href={connections}>View status in Connections</Link>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
function TransactionPage({
  scope,
  names,
  report,
  filter,
  onRestart,
}: Context & {
  report: Report;
  filter: personalTransactionsQuery['variables']['filter'];
  onRestart: () => void;
}) {
  const [more, setMore] = useState(false),
    [retry, setRetry] = useState(0);
  return (
    <>
      <ul className={styles.rows}>
        {report.rows.map((row) => (
          <li key={row.sourceId}>
            <TransactionRow scope={scope} names={names} row={row} />
          </li>
        ))}
      </ul>
      {report.hasNextPage &&
        report.endCursor &&
        (more ? (
          <NetworkQuery<personalTransactionsQuery>
            key={retry}
            scope={scope}
            document={reportDocument}
            variables={{ filter, after: report.endCursor }}
            fallback={
              <ContentLoading layout="expenses" label="more transactions" />
            }
            failure={
              <Status kind="error">
                More activity could not be loaded.{' '}
                <Button tone="text" onClick={() => setRetry((v) => v + 1)}>
                  Retry more activity
                </Button>
              </Status>
            }
          >
            {(data) =>
              data.bankingReport.code === 'READY' &&
              data.bankingReport.revision === report.revision ? (
                <TransactionPage
                  scope={scope}
                  names={names}
                  report={data.bankingReport}
                  filter={filter}
                  onRestart={onRestart}
                />
              ) : (
                <InvalidPage onRestart={onRestart} />
              )
            }
          </NetworkQuery>
        ) : (
          <Button tone="secondary" onClick={() => setMore(true)}>
            Load more transactions
          </Button>
        ))}
    </>
  );
}
function InvalidPage({ onRestart }: { onRestart: () => void }) {
  useEffect(() => onRestart(), [onRestart]);
  return null;
}
function TransactionRow({
  scope,
  names,
  row,
  selected = false,
}: Context & { row: personalTransactionRow$key; selected?: boolean }) {
  const value = useFragment(rowDocument, row),
    params = useSearchParams();
  const archive = params.get('archive');
  const label = value.merchantName || value.name || 'Bank transaction';
  return (
    <article
      className={styles.row}
      data-source-id={value.sourceId}
      tabIndex={selected ? -1 : undefined}
    >
      <div className={styles.rowMain}>
        <strong>
          {selected ? (
            label
          ) : (
            <ScopedLink
              scope={scope}
              id={`transaction-${value.sourceId}`}
              href={personalHref(new URLSearchParams(params), {
                transaction: value.sourceId,
              })}
            >
              {label}
            </ScopedLink>
          )}
        </strong>
        <span>
          {names.get(value.accountId) ?? 'Retained bank account'} ·{' '}
          <time dateTime={value.bankDate}>{value.bankDate}</time>
          {value.processingState === 'pending'
            ? ' · Provisional date'
            : ' · Posted bank date'}
        </span>
        <span>
          {readable(value.activity)} · {readable(value.category)}
        </span>
        <span>
          {value.processingState !== 'posted' &&
            `${readable(value.processingState)} · `}
          {(!value.reviewed || value.materialConflict) && 'Needs review · '}
          {value.excluded && 'Excluded · '}
          {value.materialConflict && 'Classification changed · '}
          {!value.current && 'Archive only · '}
          {value.discrepancy !== 'none' && 'Historical discrepancy · '}Source
          revision {value.sourceRevision}
        </span>
      </div>
      <div className={styles.amount}>
        <Money value={bankMoney(value.amountMinor)} currency={value.currency} />
      </div>
      {archive && (
        <div className={styles.rowProvenance}>
          <p>
            Immutable captured source and annotation provenance.
            {value.archives
              .filter((reference) => reference.archiveId === archive)
              .map((reference) => (
                <span key={reference.archiveId}>
                  {' '}
                  Source version {reference.sourceRevision}; annotation version{' '}
                  {reference.annotationRevision ?? 'none'}.
                  {reference.annotation?.note &&
                    ` Captured note: ${reference.annotation.note}`}
                </span>
              ))}
          </p>
          {value.currentId && (
            <ScopedLink
              scope={scope}
              id={`current-${value.sourceId}`}
              href={personalHref(new URLSearchParams(params), {
                transaction: value.currentId,
                archive: null,
                discrepancies: null,
              })}
            >
              View current record
            </ScopedLink>
          )}
        </div>
      )}
    </article>
  );
}
/** A fresh selected-row read outside list filters. #259 owns the full detail/editor;
 * this source/archive/discrepancy contract and ScopedLink origin remain its handoff. */
function SelectedTransaction({ scope, names }: Context) {
  const params = useSearchParams(),
    selected = transactionSelection(params);
  const [retry, setRetry] = useState(0);
  return (
    <section className={styles.selected}>
      <h2>Selected transaction</h2>
      {params.get('source') && scope.visits.has(params.get('source')!) && (
        <SourceReturn scope={scope} fallbackLabel="Back to transactions" />
      )}
      <Link
        href={personalHref(new URLSearchParams(params), { transaction: null })}
      >
        Back to transactions
      </Link>
      <NetworkQuery<personalTransactionSelectionQuery>
        key={`${selected.source}:${selected.archive}:${selected.discrepancy}:${retry}`}
        scope={scope}
        document={selectionDocument}
        variables={{
          source: selected.source!,
          archive: selected.archive,
          discrepancy: selected.discrepancy,
        }}
        fallback={
          <ContentLoading layout="expenses" label="selected transaction" />
        }
        failure={
          <Status kind="error">
            The selected private record could not be loaded.{' '}
            <Button onClick={() => setRetry((v) => v + 1)}>
              Retry selected transaction
            </Button>
          </Status>
        }
      >
        {(data) =>
          data.bankingTransaction.code === 'READY' &&
          data.bankingTransaction.transaction ? (
            <TransactionRow
              scope={scope}
              names={names}
              row={data.bankingTransaction.transaction}
              selected
            />
          ) : (
            <Status kind="error">
              This private record is unavailable or no longer accessible.
            </Status>
          )
        }
      </NetworkQuery>
    </section>
  );
}
function reportProblem(code: string) {
  switch (code) {
    case 'SETUP_REQUIRED':
      return 'No retained accounts are available. Set up selected accounts in Connections.';
    case 'NOT_INITIALIZED':
      return 'Your saved reporting timezone is being initialized. Retry after initialization.';
    case 'INVALID_INPUT':
      return 'The applied dates or filters are invalid. Choose supported values; no result or zero total is confirmed.';
    case 'RESTART_REQUIRED':
      return 'Activity changed. Restart the result with the same dates and filters.';
    case 'QUERY_LIMIT':
      return 'This selection exceeds the reporting limit. Choose a narrower range or account; no partial total is shown.';
    case 'DATA_UNAVAILABLE':
      return 'Initial history is importing or unavailable. No complete activity or total is confirmed.';
    default:
      return 'Private activity is unavailable. Retry to check current access; no total is confirmed.';
  }
}
