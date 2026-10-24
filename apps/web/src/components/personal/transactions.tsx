'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useState } from 'react';
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
import { AppIcon, type IconName } from '../workspace-identity';
import { Button, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { Money } from '../financial/presentation';
import { RestoreSource, ScopedLink, SourceReturn } from '../groups/navigation';
import { PersonalOverview } from './overview';
import { TransactionControls } from './transaction-controls';
import { TransactionDetail } from './transaction-detail';
import type { SavedOrigin } from './annotation-draft';
import {
  bankMoney,
  bankDateLabel,
  personalHref,
  readable,
  reportFilter,
  transactionSelection,
} from './transaction-state';
import { importSummary, type ImportFacts } from './status';
import styles from './transactions.module.css';
type Report = personalTransactionsQuery['response']['bankingReport'];
type Context = {
  overview?: boolean;
  scope: FinancialScope;
  names: ReadonlyMap<string, string>;
  statuses?: ReadonlyMap<string, ImportFacts>;
};
type Traversal = {
  revision: string | null;
  pages: number;
  owner: object;
  refresh?: boolean;
};
type PageProgress = (revision: string | null, pages: number) => void;
function restoreToken(scope: FinancialScope, params: URLSearchParams) {
  const historyToken =
    typeof window !== 'undefined'
      ? (window.history.state?.financialRestore as string | undefined)
      : undefined;
  const visit = historyToken ? scope.visits.get(historyToken) : undefined;
  return visit?.href ===
    (typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '')
    ? historyToken
    : params.get('restore');
}
export function PersonalTransactions(context: Context) {
  return <TransactionNavigation key={context.scope.id} {...context} />;
}
/** Retain only actor-owned revision/extent; private rows and signed cursors always
 * come from fresh authorized queries when returning across report contexts. */
function TransactionNavigation({ scope, names, statuses, overview }: Context) {
  const params = useSearchParams();
  const selection = transactionSelection(params);
  const [reportVersion, setReportVersion] = useState(0);
  const filter = reportFilter(new URLSearchParams(params));
  const identity = JSON.stringify(filter);
  const [traversals, setTraversals] = useState(new Map<string, Traversal>());
  const token = restoreToken(scope, new URLSearchParams(params));
  const visit = token && scope.isLive() ? scope.visits.get(token) : undefined;
  const origin = visit
    ? new URL(visit.href, 'https://workspace.invalid')
    : null;
  const freshTraversal = traversals.get(identity);
  const sourceVisit = params.get('source')
    ? scope.visits.get(params.get('source')!)
    : undefined;
  const sourceIdentity = sourceVisit
    ? JSON.stringify(
        reportFilter(
          new URL(sourceVisit.href, 'https://workspace.invalid').searchParams,
        ),
      )
    : identity;
  const originPages = traversals.get(sourceIdentity)?.pages ?? 1;
  const resume =
    freshTraversal?.refresh && (selection.source || visit)
      ? freshTraversal
      : origin?.pathname === '/personal' &&
          JSON.stringify(reportFilter(origin.searchParams)) === identity
        ? traversals.get(identity)
        : undefined;
  return (
    <>
      <TransactionRead
        key={`${scope.id}:${identity}:${reportVersion}`}
        overview={overview}
        scope={scope}
        names={names}
        statuses={statuses}
        filter={filter}
        resume={resume}
        onPage={(revision, pages, owner) => {
          setTraversals((previous) => {
            const saved = previous.get(identity);
            if (
              saved?.owner === owner &&
              saved.revision === revision &&
              saved.pages >= pages
            )
              return previous;
            const next = new Map(previous);
            next.set(identity, { revision, pages, owner });
            return next;
          });
        }}
      />
      {selection.source && (
        <SelectedTransaction
          scope={scope}
          names={names}
          originPages={originPages}
          onSaved={(savedOrigin) => {
            const returnIdentity = savedOrigin
              ? JSON.stringify(
                  reportFilter(
                    new URL(savedOrigin.href, 'https://workspace.invalid')
                      .searchParams,
                  ),
                )
              : identity;
            setTraversals((previous) => {
              const next = new Map(previous);
              for (const target of new Set([identity, returnIdentity])) {
                const pages = Math.max(
                  previous.get(target)?.pages ?? 1,
                  target === returnIdentity ? (savedOrigin?.pages ?? 1) : 1,
                );
                next.set(target, {
                  revision: null,
                  pages,
                  owner: {},
                  refresh: true,
                });
              }
              return next;
            });
            setReportVersion((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
function TransactionRead({
  overview,
  scope,
  names,
  statuses,
  filter,
  resume,
  onPage,
}: Context & {
  filter: personalTransactionsQuery['variables']['filter'];
  resume?: Traversal;
  onPage: (revision: string | null, pages: number, owner: object) => void;
}) {
  const [owner, setOwner] = useState({});
  const [restoring, setRestoring] = useState(resume);
  const [version, setVersion] = useState(0),
    [restart, setRestart] = useState(false);
  const retry = () => {
    setOwner({});
    setRestoring(undefined);
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
              overview={overview}
              scope={scope}
              names={names}
              statuses={statuses}
              report={data.bankingReport}
              filter={filter}
              resume={restoring}
              onPage={(revision, pages) => onPage(revision, pages, owner)}
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
  overview,
  scope,
  names,
  statuses,
  report,
  filter,
  onRestart,
  onRetry,
  resume,
  onPage,
}: Context & {
  resume?: Traversal;
  onPage: PageProgress;
  report: Report;
  filter: personalTransactionsQuery['variables']['filter'];
  onRestart: () => void;
  onRetry: () => void;
}) {
  const params = useSearchParams(),
    selection = transactionSelection(params);
  const restore = restoreToken(scope, new URLSearchParams(params));
  const [returnReady, setReturnReady] = useState<string | null>(null);
  const [extentReady, setExtentReady] = useState(!resume || resume.pages <= 1);
  const replayPages = resume?.refresh
    ? Math.min(resume.pages, Math.max(1, Math.ceil(report.totalCount / 50)))
    : (resume?.pages ?? 1);
  const emptyProgress = useEffectEvent(() => onPage(report.revision, 1));
  useEffect(() => {
    if (report.code === 'READY' && !report.rows.length) emptyProgress();
  }, [report.code, report.revision, report.rows.length]);
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
  if (
    report.code === 'READY' &&
    resume &&
    !resume.refresh &&
    (report.revision !== resume.revision ||
      (resume.pages > 1 && !report.rows.length))
  )
    return <InvalidPage onRestart={onRestart} />;
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
          {!selection.source && restore && (
            <ReturnAuthorization
              key={restore}
              scope={scope}
              filter={filter}
              onReady={() => setReturnReady(restore)}
              onRetry={onRetry}
            />
          )}
          <div hidden={Boolean(restore && returnReady !== restore)}>
            {!selection.source &&
              (extentReady || !report.rows.length) &&
              (!restore || returnReady === restore) && (
                <RestoreSource key={restore} scope={scope} allowed={[]} />
              )}
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
                      label="Back to current activity"
                    />
                  )}
                {!(
                  params.get('source') &&
                  scope.visits.has(params.get('source')!)
                ) && (
                  <Link
                    href={personalHref(new URLSearchParams(params), {
                      archive: null,
                      transaction: null,
                      discrepancies: null,
                    })}
                  >
                    Back to current activity
                  </Link>
                )}
              </div>
            )}
            {selection.discrepancy && (
              <div className={styles.notice}>
                <h2>Source discrepancies</h2>
                <p>
                  Latest source changes are shown separately. They do not
                  replace retained canonical facts or contribute to spending. A
                  date crossing the transition can leave a gap or differently
                  identified duplicate.
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
            {overview && !selection.archive && !selection.discrepancy ? (
              <PersonalOverview
                scope={scope}
                report={report}
                names={names}
                coverage={
                  <Coverage
                    report={report}
                    names={names}
                    statuses={statuses}
                    connections={connections}
                  />
                }
                recent={
                  <ul className={styles.rows}>
                    {report.rows.slice(0, 3).map((row) => (
                      <li key={row.sourceId}>
                        <TransactionRow scope={scope} names={names} row={row} />
                      </li>
                    ))}
                  </ul>
                }
              />
            ) : (
              <>
                <Coverage
                  report={report}
                  names={names}
                  statuses={statuses}
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
                        Classification incomplete. Unresolved activity is
                        separate from this subtotal.
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
                    {report.totalCount} transactions
                    <span className={styles.srOnly}>
                      {' '}
                      · complete matching count
                    </span>
                  </span>
                </div>
                {reportStatusText(report.counts) && (
                  <p className={styles.context}>
                    {reportStatusText(report.counts)}
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
                    depth={1}
                    resumePages={replayPages}
                    onPage={onPage}
                    onExtentReady={() => setExtentReady(true)}
                  />
                )}
              </>
            )}
            <details className={styles.provenance}>
              <summary>Reporting history and recovery archives</summary>
              <p>
                Applied posted bank dates: {report.start} – {report.end}. Saved
                reporting timezone: {report.timezone}.
              </p>
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
                      Import: {readable(interval.importState)}. Collection:{' '}
                      {readable(interval.collectionState)}. Last local import:{' '}
                      {interval.lastLocalCommit ?? 'Unknown'}; bank success
                      observation: {interval.providerSuccessAt ?? 'Unknown'}.
                      Actual coverage: after{' '}
                      {interval.coverageAfter ?? 'Unknown'} through{' '}
                      {interval.coverageThrough ?? 'Unknown'}.{' '}
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
                          tab: 'transactions',
                          archive: archive.id,
                          source: null,
                          discrepancies: null,
                          transaction: null,
                        })}
                      >
                        View recovery archive · through {archive.boundaryDate} ·{' '}
                        {archive.count} records · plan {archive.planId}
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
                    tab: 'transactions',
                    discrepancies: 'true',
                    source: null,
                    archive: null,
                    transaction: null,
                  })}
                >
                  Inspect source discrepancies
                </ScopedLink>
              )}
            </details>
            <p className={styles.privacy}>
              Only you can see these bank accounts and their activity.
            </p>
          </div>
        </>
      )}
    </>
  );
}
/** Reauthorize the complete source before revealing retained pages or restoring
 * focus. Relay updates the first snapshot; incompatible continuation revisions
 * still discard the traversal through its existing restart boundary. */
function ReturnAuthorization({
  scope,
  filter,
  onReady,
  onRetry,
}: {
  scope: FinancialScope;
  filter: personalTransactionsQuery['variables']['filter'];
  onReady: () => void;
  onRetry: () => void;
}) {
  return (
    <NetworkQuery<personalTransactionsQuery>
      scope={scope}
      document={reportDocument}
      variables={{ filter }}
      fallback={
        <ContentLoading layout="expenses" label="returning transactions" />
      }
      failure={
        <Status kind="error">
          Activity could not be reauthorized.{' '}
          <Button onClick={onRetry}>Retry activity</Button>
        </Status>
      }
      onState={(state) => {
        if (!state.busy && !state.error) onReady();
      }}
    >
      {() => null}
    </NetworkQuery>
  );
}
function reportStatusText(counts: Report['counts']) {
  if (!counts) return '';
  return [
    counts.pendingCount && `${counts.pendingCount} pending`,
    counts.unresolvedCount && `${counts.unresolvedCount} unresolved`,
    counts.count - counts.reviewedCount &&
      `${counts.count - counts.reviewedCount} not reviewed`,
    counts.excludedCount && `${counts.excludedCount} excluded`,
    counts.removedCount && `${counts.removedCount} removed`,
  ]
    .filter(Boolean)
    .join(' · ');
}
function importNeedsContext(status: ImportFacts) {
  return (
    !status.usable ||
    status.freshness === 'STALE' ||
    status.recovery === 'CONTACT_SUPPORT' ||
    status.collection !== 'COLLECTING'
  );
}
function Coverage({
  report,
  names,
  statuses,
  connections,
}: {
  report: Report;
  names: ReadonlyMap<string, string>;
  statuses?: ReadonlyMap<string, ImportFacts>;
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
            {account.coverage !== 'COMPLETE' && ' · Activity may be missing.'}
          </p>
          {statuses?.get(account.accountId) &&
            importNeedsContext(statuses.get(account.accountId)!) && (
              <p>{importSummary(statuses.get(account.accountId)!)}</p>
            )}
          {account.intervals.some(
            (interval) => interval.discrepancyCount > 0,
          ) && (
            <p>
              Historical discrepancy: later source changes are retained for
              inspection; current totals keep the confirmed reporting history.
            </p>
          )}
          {(statuses?.get(account.accountId)?.collection ===
            'RECONNECT_REQUIRED' ||
            account.intervals.some(
              (interval) =>
                interval.collectionStopped ||
                !['usable'].includes(interval.importState) ||
                interval.discrepancyCount > 0,
            )) && (
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
  depth,
  resumePages,
  onPage,
  onExtentReady,
}: Context & {
  depth: number;
  resumePages: number;
  onPage: PageProgress;
  onExtentReady: () => void;
  report: Report;
  filter: personalTransactionsQuery['variables']['filter'];
  onRestart: () => void;
}) {
  const [more, setMore] = useState(resumePages > depth),
    [retry, setRetry] = useState(0);
  const progress = useEffectEvent(() => {
    onPage(report.revision, depth);
    if (depth >= resumePages) onExtentReady();
    else if (!report.hasNextPage || !report.endCursor) onRestart();
  });
  useEffect(
    () => progress(),
    [report.revision, depth, resumePages, report.hasNextPage, report.endCursor],
  );
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
                  depth={depth + 1}
                  resumePages={resumePages}
                  onPage={onPage}
                  onExtentReady={onExtentReady}
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
  const archive = params.get('archive'),
    label = value.merchantName || value.name || 'Bank transaction';
  const context = [
    readable(value.activity),
    names.get(value.accountId) ?? 'Retained bank account',
    value.processingState !== 'posted' ? readable(value.processingState) : '',
    !value.reviewed || value.materialConflict ? 'Needs review' : '',
    value.excluded ? 'Excluded' : '',
    value.materialConflict ? 'Classification changed' : '',
    !value.current ? 'Archive only' : '',
    value.discrepancy !== 'none' ? 'Historical discrepancy' : '',
    selected
      ? `${readable(value.category)} · Source revision ${value.sourceRevision}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const identity = `${selected ? 'selected' : 'row'}-${value.sourceId}`;
  const includeYear =
    selected ||
    (params.get('period') === 'custom' &&
      params.get('start')?.slice(0, 4) !== params.get('end')?.slice(0, 4));
  const content = (
    <>
      <span className={styles.category} aria-hidden="true">
        <AppIcon name={bankingIcon(value.activity, value.category)} />
      </span>
      <span className={styles.rowMain}>
        <strong>{label}</strong>
        <span id={`${identity}-context`}>{context}</span>
      </span>
      <span className={styles.amount} id={`${identity}-amount`}>
        <Money
          value={bankMoney(value.amountMinor)}
          currency={value.currency}
          focusable={selected}
        />
        <span>
          <time
            dateTime={value.bankDate}
            aria-label={`${value.processingState === 'pending' ? 'Provisional date' : 'Posted bank date'} ${value.bankDate}`}
          >
            {bankDateLabel(value.bankDate, includeYear)}
          </time>
        </span>
      </span>
    </>
  );
  return (
    <article
      className={styles.row}
      data-source-id={value.sourceId}
      tabIndex={selected ? -1 : undefined}
    >
      {selected ? (
        <div className={styles.rowLink}>{content}</div>
      ) : (
        <ScopedLink
          scope={scope}
          id={`transaction-${value.sourceId}`}
          className={styles.rowLink}
          aria-label={label}
          aria-describedby={`${identity}-context ${identity}-amount`}
          href={personalHref(new URLSearchParams(params), {
            transaction: value.sourceId,
            source: null,
          })}
        >
          {content}
        </ScopedLink>
      )}
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
              id={`${selected ? 'selected-current' : 'current'}-${value.sourceId}`}
              href={personalHref(new URLSearchParams(params), {
                transaction: value.currentId,
                source: null,
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
function bankingIcon(activity: string, category: string): IconName {
  if (activity === 'refund') return 'back';
  if (activity === 'income') return 'wallet';
  if (['transfer', 'repayment'].includes(activity)) return 'activity';
  const icons: Record<string, IconName> = {
    FOOD_AND_DRINK: 'dining',
    TRANSPORTATION: 'car',
    TRAVEL: 'trip',
    RENT_AND_UTILITIES: 'home',
    HOME_IMPROVEMENT: 'home',
    ENTERTAINMENT: 'activity',
  };
  return icons[category] ?? 'expense';
}
/** Fresh owner-only detail outside filters; URL source identity remains stable. */
function SelectedTransaction({
  scope,
  names,
  onSaved,
  originPages,
}: Context & { onSaved: (origin?: SavedOrigin) => void; originPages: number }) {
  const params = useSearchParams(),
    selected = transactionSelection(params);
  const [retry, setRetry] = useState(0);
  const [savedSelection, setSavedSelection] = useState<string | null>(null);
  const selectionIdentity = `${scope.id}:${selected.source}:${selected.archive}:${selected.discrepancy}`;
  return (
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
          <ClearSavedEditFocus onClear={() => setSavedSelection(null)} />
          The selected private record could not be loaded.{' '}
          <Button onClick={() => setRetry((value) => value + 1)}>
            Retry selected transaction
          </Button>
          <Link
            href={personalHref(new URLSearchParams(params), {
              transaction: null,
            })}
          >
            Back to transactions
          </Link>
        </Status>
      }
    >
      {(data) =>
        data.bankingTransaction.code === 'READY' &&
        data.bankingTransaction.transaction ? (
          <TransactionDetail
            key={`${scope.id}:${selected.source}:${selected.archive}:${selected.discrepancy}`}
            scope={scope}
            names={names}
            transaction={data.bankingTransaction.transaction}
            archive={selected.archive}
            discrepancy={selected.discrepancy}
            originPages={originPages}
            onFieldSaved={onSaved}
            focusEdit={savedSelection === selectionIdentity}
            onFocusedEdit={() => setSavedSelection(null)}
            onSaved={() => {
              setSavedSelection(selectionIdentity);
              setRetry((value) => value + 1);
            }}
          />
        ) : (
          <Status kind="error">
            <ClearSavedEditFocus onClear={() => setSavedSelection(null)} />
            This private record is unavailable or no longer accessible.{' '}
            <Link
              href={personalHref(new URLSearchParams(params), {
                transaction: null,
              })}
            >
              Back to transactions
            </Link>
          </Status>
        )
      }
    </NetworkQuery>
  );
}
/** A failed fresh detail relinquishes the pending navigation-only focus intent. */
function ClearSavedEditFocus({ onClear }: { onClear: () => void }) {
  const clear = useEffectEvent(onClear);
  useEffect(() => clear(), []);
  return null;
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
