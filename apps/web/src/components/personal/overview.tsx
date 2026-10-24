'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import type { FinancialScope } from '@/lib/relay/environment';
import type { personalTransactionsQuery } from '@/lib/relay/__generated__/personalTransactionsQuery.graphql';
import { Money } from '../financial/presentation';
import { ScopedLink } from '../groups/navigation';
import { Button, Dialog } from '../ui/primitives';
import { bankMoney, personalHref, readable } from './transaction-state';
import styles from './overview.module.css';
type Report = personalTransactionsQuery['response']['bankingReport'];
/** Presentation consumes the complete authorized report; recent rows never own totals. */
export function PersonalOverview({
  scope,
  report,
  names,
  coverage,
  recent,
}: {
  scope: FinancialScope;
  report: Report;
  names: ReadonlyMap<string, string>;
  coverage: ReactNode;
  recent: ReactNode;
}) {
  const params = useSearchParams();
  const [help, setHelp] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const transactions = personalHref(new URLSearchParams(params), {
    tab: 'transactions',
    transaction: null,
    source: null,
  });
  const unresolved = report.counts?.unresolvedCount ?? 0;
  const notReviewed = report.counts
    ? report.counts.count - report.counts.reviewedCount
    : 0;
  const complete =
    report.accounts.length > 0 &&
    report.accounts.every((account) => account.coverage === 'COMPLETE');
  return (
    <>
      <section
        className={styles.card}
        aria-labelledby="personal-spending-heading"
      >
        <div className={styles.heading}>
          <h2 id="personal-spending-heading">Spending from your accounts</h2>
          <Button
            ref={helpButton}
            tone="text"
            aria-label="How spending is calculated"
            aria-haspopup="dialog"
            onClick={() => setHelp(true)}
          >
            ?
          </Button>
        </div>
        {report.summary ? (
          <>
            <div className={styles.total}>
              <Money
                value={bankMoney(report.summary.netMinor)}
                currency="USD"
              />
            </div>
            <dl className={styles.breakdown}>
              <div>
                <dt>Purchases &amp; charges</dt>
                <dd>
                  <Money
                    value={bankMoney(report.summary.purchaseMinor)}
                    currency="USD"
                  />
                </dd>
              </div>
              <div>
                <dt>Refunds received</dt>
                <dd>
                  <Money
                    value={bankMoney(report.summary.refundMinor)}
                    currency="USD"
                  />
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p>
            Activity context only. No spending total applies to these filters.
          </p>
        )}
        {!complete && (
          <p className={styles.warning}>
            History is partial or unknown. Available activity may not cover the
            full requested period.
          </p>
        )}
        {report.summary && !report.summary.classificationComplete && (
          <p className={styles.warning}>
            Classification incomplete. Unresolved activity stays separate from
            this subtotal.
          </p>
        )}
        {coverage}
      </section>
      {notReviewed > 0 && (
        <ScopedLink
          scope={scope}
          id="overview-review"
          className={styles.review}
          href={personalHref(new URLSearchParams(params), {
            tab: 'transactions',
            transaction: null,
            source: null,
            reviewed: 'false',
          })}
        >
          {unresolved}{' '}
          {unresolved === 1 ? 'transaction needs' : 'transactions need'}{' '}
          classification · Review activity
        </ScopedLink>
      )}
      {report.counts &&
        (report.counts.pendingCount > 0 ||
          report.counts.excludedCount > 0 ||
          unresolved > 0) && (
          <p className={styles.context}>
            {report.counts.pendingCount} pending · {report.counts.excludedCount}{' '}
            excluded. Separate from spending.
          </p>
        )}
      <div className={styles.grid}>
        <section aria-labelledby="personal-recent-heading">
          <div className={styles.heading}>
            <h2 id="personal-recent-heading">Recent activity</h2>
            <ScopedLink
              scope={scope}
              id="overview-view-all"
              href={transactions}
            >
              View all
            </ScopedLink>
          </div>
          {report.rows.length ? (
            recent
          ) : (
            <p className={styles.context}>
              {complete
                ? 'No activity in this period.'
                : 'No imported activity in this period. History may be missing.'}
            </p>
          )}
        </section>
        <aside
          className={styles.accounts}
          aria-labelledby="personal-accounts-heading"
        >
          <h2 id="personal-accounts-heading">Your accounts</h2>
          {report.accounts.map((account) => (
            <p key={account.accountId}>
              {names.get(account.accountId) ??
                `Retained ${readable(account.kind)} account`}
              <small>
                {account.selected
                  ? 'Updates selected'
                  : 'Retained history · updates stopped'}
              </small>
            </p>
          ))}
          <Link
            href={personalHref(new URLSearchParams(params), {
              tab: 'connections',
              transaction: null,
            })}
          >
            Manage accounts
          </Link>
        </aside>
      </div>
      {help && (
        <Dialog
          open
          title="About this spending total"
          onClose={() => setHelp(false)}
          returnFocusRef={helpButton}
        >
          <p>
            Posted purchases, bank fees and debit interest, less identified
            refunds received in the selected period. Refunds reduce their
            posting period, so spending can be negative.
          </p>
          <p>
            Pending activity, income, transfers, card repayments, cash
            withdrawals, exclusions and unresolved activity stay separate.
          </p>
          <p>
            This is activity from your accounts, not your allocated share of
            household or group expenses. A joint account can include another
            person’s purchases.
          </p>
        </Dialog>
      )}
    </>
  );
}
