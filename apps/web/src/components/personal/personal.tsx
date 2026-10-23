'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFinancialSession } from '../groups/session';
import { RestoreSource } from '../groups/navigation';
import { NetworkQuery } from '@/lib/relay/query';
import type { FinancialScope } from '@/lib/relay/environment';
import document, {
  type personalInventoryQuery,
} from '@/lib/relay/__generated__/personalInventoryQuery.graphql';
import { Button, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { WorkspaceRefresh } from '../workspace-refresh';
import { WorkspaceLoading } from '../workspace-loading';
import { useForegroundRefresh } from '../groups/foreground';
import { Enrollment } from './enrollment';
import { Management } from './management';
import { ManagementRecovery } from './management-attempt';
import { PersonalTransactions } from './transactions';
import { ReportingTimezoneInitialization } from './reporting-timezone-control';
import { importSummary, coverageSummary, type ImportFacts } from './status';
import styles from './personal.module.css';
export const personalSections = [
  'Overview',
  'Transactions',
  'Connections',
] as const;
export type PersonalSection = (typeof personalSections)[number];
export function personalSection(value: string | null): PersonalSection {
  return (
    personalSections.find((section) => section.toLowerCase() === value) ??
    'Overview'
  );
}
export function PersonalWorkspace() {
  const access = useFinancialSession();
  const params = useSearchParams(),
    pathname = usePathname();
  const section = personalSection(params.get('tab'));
  if (access.loading) return <ContentLoading layout="cards" label="Personal" />;
  if (access.error) return <Status kind="error">{access.error}</Status>;
  if (!access.scope)
    return (
      <p>
        <Link
          href={`/sign-in?next=${encodeURIComponent(pathname + '?' + params)}`}
        >
          Sign in
        </Link>{' '}
        to see your private accounts.
      </p>
    );
  return (
    <PersonalRead
      key={`${access.scope.id}:${section}`}
      scope={access.scope}
      section={section}
    />
  );
}
function PersonalRead({
  scope,
  section,
}: {
  scope: FinancialScope;
  section: PersonalSection;
}) {
  const paramsPeriod = useSearchParams().get('period');
  const [version, setVersion] = useState(0),
    [active, setActive] = useState(true);
  const [state, setState] = useState({ busy: true, error: false });
  const [denied, setDenied] = useState(false);
  const refresh = () => {
    scope.invalidate();
    setState({ busy: true, error: false });
    setDenied(false);
    setVersion((v) => v + 1);
    setActive(true);
  };
  useForegroundRefresh(() => {
    setActive(false);
    setState({ busy: true, error: false });
  }, refresh);
  const loading = <ContentLoading layout="cards" label="Personal accounts" />;
  const failure = (
    <Status kind="error">
      Private accounts could not be loaded. Retry to check current access.
    </Status>
  );
  const error =
    denied || state.error
      ? 'Private accounts are unavailable. Retry to check current access.'
      : '';
  return (
    <WorkspaceLoading busy={state.busy}>
      <WorkspaceRefresh
        contentPending
        busy={state.busy}
        error={error}
        onRefresh={refresh}
      />
      {active ? (
        <NetworkQuery<personalInventoryQuery>
          key={version}
          scope={scope}
          document={document}
          variables={{ first: 20 }}
          fallback={loading}
          failure={failure}
          onState={setState}
        >
          {(data) =>
            data.bankingConnections.code === 'READY' ? (
              <>
                {(section !== 'Transactions' ||
                  !data.bankingConnections.connections.some(
                    (connection) => connection.accounts.length > 0,
                  )) && <RestoreSource scope={scope} allowed={[]} />}
                <ReportingTimezoneInitialization
                  showPeriod={
                    section === 'Overview' &&
                    (paramsPeriod === null || paramsPeriod === 'this-month')
                  }
                />
                {section !== 'Connections' &&
                  (section !== 'Transactions' ||
                    (!data.bankingConnections.connections.some(
                      (connection) => connection.accounts.length > 0,
                    ) &&
                      !data.bankingConnections.hasNextPage)) && (
                    <p className={styles.privacy}>
                      Only you can see these bank accounts and their activity.
                    </p>
                  )}
                {section === 'Connections' ? (
                  <>
                    <section
                      id="existing-connections"
                      aria-labelledby="connections-heading"
                      className={styles.stack}
                    >
                      <Enrollment scope={scope} onConnected={refresh} />
                      <ManagementRecovery scope={scope} onChanged={refresh} />
                      <p className={styles.connectionsHelp}>
                        Selection controls updates. History is retained.
                      </p>
                      {!data.bankingConnections.connections.length && (
                        <div className={styles.empty}>
                          <h3>No connected accounts yet</h3>
                          <p>
                            Connect an institution above, then explicitly choose
                            the accounts to include.
                          </p>
                        </div>
                      )}
                      <div className={styles.connectionsGrid}>
                        <InventoryPage
                          scope={scope}
                          result={data.bankingConnections}
                          onChanged={refresh}
                        />
                      </div>
                      <p className={styles.privacy}>
                        Your bank activity is private. Connecting an account
                        never shares it with your household or groups.
                      </p>
                    </section>
                  </>
                ) : section === 'Transactions' &&
                  (data.bankingConnections.connections.some(
                    (connection) => connection.accounts.length > 0,
                  ) ||
                    data.bankingConnections.hasNextPage) ? (
                  <TransactionInventory
                    scope={scope}
                    result={data.bankingConnections}
                  />
                ) : (
                  <ActivityBoundary
                    section={section}
                    connected={
                      data.bankingConnections.connections.some(
                        (connection) => connection.accounts.length > 0,
                      ) || data.bankingConnections.hasNextPage
                    }
                  />
                )}
              </>
            ) : (
              <Denied onDenied={() => setDenied(true)} />
            )
          }
        </NetworkQuery>
      ) : (
        loading
      )}
    </WorkspaceLoading>
  );
}
function Denied({ onDenied }: { onDenied: () => void }) {
  // Domain failures never become an empty private account list.
  useEffect(() => {
    onDenied();
  }, [onDenied]);
  return (
    <Status kind="error">
      Private banking is unavailable for this account. Check access before
      continuing.
    </Status>
  );
}
function ActivityBoundary({
  section,
  connected,
}: {
  section: PersonalSection;
  connected: boolean;
}) {
  const params = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', 'connections');
  return (
    <section
      className={styles.empty}
      aria-labelledby="personal-content-heading"
    >
      <p className={styles.eyebrow}>
        {params.get('period') === null ? 'This month' : 'Applied period'}
      </p>
      <h2 id="personal-content-heading">
        {section === 'Overview'
          ? 'Spending from your accounts'
          : 'Your private transactions'}
      </h2>
      {connected ? (
        <p>
          Your connected accounts and import status are available in
          Connections. No{' '}
          {section === 'Overview' ? 'spending summary' : 'transaction list'} is
          available here yet.
        </p>
      ) : (
        <p>
          Set up your private accounts in Connections to begin importing
          history. Available history depends on your institution.
        </p>
      )}
      <Link className={styles.link} href={`/personal?${next}`}>
        Go to Connections
      </Link>
    </section>
  );
}
type AccountLabel = { name: string; status: ImportFacts; current: boolean };
/** Retain every authorized inventory page for report account labels. Logical
 * account IDs can appear on retired bindings; current bindings own status/name
 * preference without erasing truthful retained-only account identity. */
function TransactionInventory({
  scope,
  result,
  known = new Map(),
}: {
  scope: FinancialScope;
  result: personalInventoryQuery['response']['bankingConnections'];
  known?: ReadonlyMap<string, AccountLabel>;
}) {
  const [retry, setRetry] = useState(0);
  const labels = new Map(known);
  for (const connection of result.connections)
    for (const account of connection.accounts) {
      const current = account.importStatus.reportingState === 'CURRENT';
      if (
        !labels.has(account.id) ||
        current ||
        !labels.get(account.id)!.current
      )
        labels.set(account.id, {
          name: account.name,
          status: account.importStatus,
          current,
        });
    }
  if (result.hasNextPage && !result.endCursor)
    return (
      <Status kind="error">
        Private account identities cannot be continued. Retry to check current
        access.
      </Status>
    );
  if (result.hasNextPage && result.endCursor)
    return (
      <NetworkQuery<personalInventoryQuery>
        key={retry}
        scope={scope}
        document={document}
        variables={{ first: 20, after: result.endCursor }}
        fallback={<ContentLoading layout="cards" label="account identities" />}
        failure={
          <Status kind="error">
            Account identities could not be loaded.{' '}
            <Button tone="text" onClick={() => setRetry((value) => value + 1)}>
              Retry account identities
            </Button>
          </Status>
        }
      >
        {(data) =>
          data.bankingConnections.code === 'READY' ? (
            <TransactionInventory
              scope={scope}
              result={data.bankingConnections}
              known={labels}
            />
          ) : (
            <Status kind="error">
              Private accounts are unavailable. Retry to check current access.
            </Status>
          )
        }
      </NetworkQuery>
    );
  return (
    <PersonalTransactions
      scope={scope}
      names={new Map([...labels].map(([id, account]) => [id, account.name]))}
      statuses={
        new Map([...labels].map(([id, account]) => [id, account.status]))
      }
    />
  );
}
function InventoryPage({
  scope,
  result,
  onChanged,
}: {
  onChanged: () => void;
  scope: FinancialScope;
  result: personalInventoryQuery['response']['bankingConnections'];
}) {
  const [next, setNext] = useState(false),
    [retry, setRetry] = useState(0);
  return (
    <>
      {result.connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          scope={scope}
          onChanged={onChanged}
        />
      ))}
      {result.hasNextPage &&
        result.endCursor &&
        (next ? (
          <NetworkQuery<personalInventoryQuery>
            key={retry}
            document={document}
            scope={scope}
            variables={{ first: 20, after: result.endCursor }}
            fallback={
              <ContentLoading layout="cards" label="more connections" />
            }
            failure={
              <Status kind="error">
                More connections could not be loaded.{' '}
                <Button tone="text" onClick={() => setRetry((v) => v + 1)}>
                  Retry more connections
                </Button>
              </Status>
            }
          >
            {(data) =>
              data.bankingConnections.code === 'READY' ? (
                <InventoryPage
                  scope={scope}
                  result={data.bankingConnections}
                  onChanged={onChanged}
                />
              ) : (
                <Status kind="error">
                  More connections are unavailable. Check current access.
                </Status>
              )
            }
          </NetworkQuery>
        ) : (
          <Button tone="secondary" onClick={() => setNext(true)}>
            Load more connections
          </Button>
        ))}
    </>
  );
}
function ConnectionCard({
  connection,
  scope,
  onChanged,
}: {
  scope: FinancialScope;
  onChanged: () => void;
  connection: personalInventoryQuery['response']['bankingConnections']['connections'][number];
}) {
  const accounts = [...connection.accounts].sort(
    (a, b) => Number(b.selected) - Number(a.selected),
  );
  const needsRepair =
    connection.health === 'repair_required' ||
    accounts.some((a) =>
      ['REVOKED', 'RECONNECT_REQUIRED'].includes(a.importStatus.collection),
    );
  const institution =
    connection.institutionName ??
    'Bank connection — institution name unavailable';
  const latestObservation = (
    field: 'lastLocalCommit' | 'providerSuccessAt',
  ) => {
    const times = accounts
      .map((a) => a.importStatus[field])
      .filter((v): v is string => Boolean(v))
      .map((v) => new Date(v).getTime())
      .filter(Number.isFinite);
    if (!times.length) return 'Unknown';
    const latest = Math.max(...times);
    return new Date(latest).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };
  return (
    <article className={`${styles.panel} ${styles.connectionCard}`}>
      <header className={styles.connectionHeading}>
        <div>
          <h3>{institution}</h3>
          <small>
            {accounts.filter((a) => a.selected).length} of {accounts.length}{' '}
            accounts included
          </small>
        </div>
        <span>
          {connection.permission === 'revoked'
            ? 'Permission revoked'
            : needsRepair
              ? 'Needs repair'
              : connection.state === 'active'
                ? 'Connected'
                : connection.state.replaceAll('_', ' ')}
        </span>
      </header>
      {accounts.map((account) => (
        <section
          className={styles.connectionAccount}
          key={account.streamId}
          aria-label={account.name}
        >
          <div>
            <h4>{account.name}</h4>
            <small>
              {account.kind.replaceAll('_', ' ')} · {account.currency}
            </small>
            {accountAttention(account) && (
              <p className={styles.accountAttention}>
                {accountAttention(account)}
              </p>
            )}
          </div>
          <small>{account.selected ? 'Included' : 'Not collecting'}</small>
        </section>
      ))}
      {!accounts.length && (
        <p>
          No visible retained account history is available for this connection.
        </p>
      )}
      <footer className={styles.connectionFooter}>
        <div className={styles.connectionActions}>
          <details className={styles.importDetails}>
            <summary>
              <span className={styles.observations}>
                <span>
                  Latest local save: {latestObservation('lastLocalCommit')}
                </span>
                <span>
                  Latest bank success: {latestObservation('providerSuccessAt')}
                </span>
              </span>
              <span>Import details</span>
            </summary>
            <div className={styles.importFacts}>
              <p>
                Local persistence does not prove the bank is up to date. Bank
                success is an observation, not complete period coverage. Latest
                observations above may apply to different accounts.
              </p>
              {accounts.map((account) => (
                <section
                  className={styles.account}
                  key={account.streamId}
                  aria-label={`${account.name} import details`}
                >
                  <h4>{account.name}</h4>
                  <p>{importSummary(account.importStatus)}</p>
                  <p>{coverageSummary(account.importStatus)}</p>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Last local import</dt>
                      <dd>
                        {account.importStatus.lastLocalCommit
                          ? new Date(
                              account.importStatus.lastLocalCommit,
                            ).toLocaleString()
                          : 'Unknown'}
                      </dd>
                    </div>
                    <div>
                      <dt>Bank success observation</dt>
                      <dd>
                        {account.importStatus.providerSuccessAt
                          ? new Date(
                              account.importStatus.providerSuccessAt,
                            ).toLocaleString()
                          : 'Unknown'}
                      </dd>
                    </div>
                    <div>
                      <dt>Initial history requested</dt>
                      <dd>
                        {account.requestedHistoryDays} days, subject to
                        institution availability
                      </dd>
                    </div>
                  </dl>
                  <p className={styles.muted}>
                    Local persistence does not prove the bank is up to date.
                    Imported history remains private.
                  </p>
                  {account.importStatus.discrepancyCount !== '0' && (
                    <p>
                      Historical discrepancy reported. Retained history may need
                      inspection in account management.
                    </p>
                  )}
                </section>
              ))}
            </div>
          </details>
          <Management
            scope={scope}
            connectionId={connection.id}
            needsRepair={needsRepair}
            onChanged={onChanged}
          />
        </div>
      </footer>
    </article>
  );
}
function accountAttention(
  account: personalInventoryQuery['response']['bankingConnections']['connections'][number]['accounts'][number],
) {
  const status = account.importStatus;
  const notices: string[] = [];
  if (status.collection === 'RECONNECT_REQUIRED')
    notices.push('Reconnect needed');
  else if (status.collection === 'REVOKED')
    notices.push('Permission revoked; updates stopped');
  else if (['DISCONNECTED', 'RETIRED', 'CANCELLED'].includes(status.collection))
    notices.push('Updates stopped; history retained');
  else if (status.reportingState === 'STAGED')
    notices.push('Replacement staged; not in current reporting');
  else if (status.recovery === 'CONTACT_SUPPORT')
    notices.push('Import needs attention');
  else if (!status.usable)
    notices.push(
      status.importState === 'UNAVAILABLE'
        ? 'History unavailable'
        : 'History importing',
    );
  else if (status.freshness === 'STALE') notices.push('Updates stale');
  if (status.coverage === 'KNOWN_GAP') notices.push('Known collection gap');
  else if (status.coverage === 'LIMITED') notices.push('Limited history');
  if (status.discrepancyCount !== '0') notices.push('Historical discrepancy');
  return notices.join(' · ');
}
