'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AppIcon } from '@/components/workspace-identity';
import { RichHelp, BalanceExplanation } from '@/components/rich-help';
import { Money } from '../financial/presentation';
import type { FinancialScope } from '@/lib/relay/environment';
import { minor, money } from '@/lib/relay/money';
import { spaceRepaymentHref, type SpaceRoute } from '@/lib/relay/space-routes';
import { Member } from '../ui/primitives';
import { ScopedLink } from './navigation';
import styles from './balance-sections.module.css';

/** Native keyboard disclosure; only open/closed metadata survives authorized remounts. */
export function BalanceSection({
  scope,
  identity,
  summary,
  children,
  initiallyOpen = false,
  open: controlledOpen,
  onOpenChange,
}: {
  scope: FinancialScope;
  identity: string;
  summary: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setOpen] = useState(
    () => scope.balanceExpansions?.get(identity) ?? initiallyOpen,
  );
  const open = controlledOpen ?? localOpen;
  return (
    <details
      className={styles.section}
      data-ui="balance-section"
      open={open}
      onToggle={(event) => {
        if (scope.isLive && !scope.isLive()) return;
        const next = event.currentTarget.open;
        scope.balanceExpansions?.set(identity, next);
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary id={`balance-section-${identity}`} aria-expanded={open}>
        {summary}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}

/** Sum complete per-source positions separately; offsetting sources stay visible. */
export function balanceDirections(
  positions: readonly (string | null | undefined)[],
) {
  if (positions.some((value) => value == null)) return undefined;
  let owe = 0n,
    owed = 0n;
  for (const value of positions) {
    const net = minor(value!);
    if (net < 0n) owe -= net;
    else owed += net;
  }
  return {
    owe: owe.toString(),
    owed: owed.toString(),
    net: (owed - owe).toString(),
  };
}

/** Derived cross-source totals can exceed one signed wire amount's range. */
function balanceMoney(value: string) {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}$${(absolute / 100n).toLocaleString('en-US')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function BalanceHeading() {
  return (
    <div className={styles.heading}>
      <h2>Your balances</h2>
      <RichHelp label="How balances work">
        <BalanceExplanation household />
        <p>
          You can record partial repayments, overpayments and actual transfers
          without a suggestion. Each transfer stays within its original space.
        </p>
      </RichHelp>
    </div>
  );
}

export function BalanceSummary({
  positions,
  currency,
}: {
  positions: readonly (string | null | undefined)[];
  currency: string;
}) {
  const totals = balanceDirections(positions);
  return (
    <div data-ui="balance-summary">
      <div className={styles.metrics}>
        <div>
          <span>You owe</span>
          {totals ? (
            <Money value={balanceMoney(totals.owe)} currency={currency} />
          ) : (
            <strong>Unavailable</strong>
          )}
        </div>
        <div>
          <span>You’re owed</span>
          {totals ? (
            <Money value={balanceMoney(totals.owed)} currency={currency} />
          ) : (
            <strong>Unavailable</strong>
          )}
        </div>
      </div>
      <div className={styles.net}>
        {totals ? (
          <span>Net {balanceMoney(totals.net)}</span>
        ) : (
          <span>Complete balance unavailable</span>
        )}
        <span>{currency}</span>
      </div>
    </div>
  );
}

export function SourceSummary({
  name,
  icon,
  detail,
}: {
  name: string;
  icon: 'home' | 'trip' | 'groups';
  detail: ReactNode;
}) {
  return (
    <>
      <span className={styles.sourceIcon}>
        <AppIcon name={icon} />
      </span>
      <span data-ui="balance-source-copy" className={styles.sourceCopy}>
        <strong>{name}</strong>
        <span>{detail}</span>
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ⌄
      </span>
    </>
  );
}

/** Bulk controls update the same account-owned metadata as each native disclosure. */
export function BalanceSources({
  scope,
  identities,
  children,
}: {
  scope: FinancialScope;
  identities: readonly string[];
  children: (
    open: Record<string, boolean>,
    change: (id: string, value: boolean) => void,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      identities.map((id) => [id, scope.balanceExpansions?.get(id) ?? false]),
    ),
  );
  const anyOpen = identities.some((id) => open[id]);
  const change = (id: string, value: boolean) => {
    if (!scope.isLive()) return;
    scope.balanceExpansions?.set(id, value);
    setOpen((current) => ({ ...current, [id]: value }));
  };
  return (
    <>
      <div className={styles.toolbar}>
        <h3>By space</h3>
        <button
          type="button"
          data-ui="form-button"
          onClick={() => {
            if (!scope.isLive()) return;
            const next = Object.fromEntries(
              identities.map((id) => [id, !anyOpen]),
            );
            for (const id of identities)
              scope.balanceExpansions?.set(id, !anyOpen);
            setOpen(next);
          }}
        >
          {anyOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {children(open, change)}
    </>
  );
}

type ObligationSource = {
  space: SpaceRoute & { name: string; currency: string };
  viewer: string;
  netMinor?: string | null;
  obligations: readonly BalanceObligation[] | undefined;
  eligible: (id: string) => boolean;
};

/** A bounded preview uses explicit complete server edges, never a net-derived party. */
export function ObligationPreview({
  scope,
  sources,
  href,
}: {
  href?: string;
  scope: FinancialScope;
  sources: readonly ObligationSource[];
}) {
  const rows = sources
    .flatMap((source) =>
      (source.obligations ?? [])
        .filter(
          (edge) =>
            (edge.from.id === source.viewer || edge.to.id === source.viewer) &&
            source.eligible(edge.from.id) &&
            source.eligible(edge.to.id) &&
            minor(edge.amountMinor) > 0n,
        )
        .map((edge) => ({ source, edge })),
    )
    .slice(0, 2);
  const unavailable = sources.some(
    (source) => source.obligations === undefined || source.netMinor == null,
  );
  const outstanding = sources.some(
    (source) => source.netMinor != null && minor(source.netMinor) !== 0n,
  );
  return (
    <section
      data-ui="obligation-preview"
      className={styles.preview}
      aria-label="Your balances"
    >
      <div className={styles.heading}>
        <h2>Your balances</h2>
        {href && <Link href={href}>View all</Link>}
      </div>
      {unavailable && (
        <p>
          Some repayment options are unavailable. Open Balances for current
          source details.
        </p>
      )}
      {!rows.length && !unavailable && (
        <p>
          {outstanding
            ? 'Open Balances for current repayment choices and source details.'
            : 'Nothing for you to pay or collect.'}
        </p>
      )}
      {rows.map(({ source, edge }) => (
        <ObligationRows
          key={`${source.space.id}-${edge.from.id}-${edge.to.id}`}
          scope={scope}
          {...source}
          obligations={[edge]}
          showSource
        />
      ))}
    </section>
  );
}

type Party = { id: string; displayName: string };
export type BalanceObligation = {
  from: Party;
  to: Party;
  amountMinor: string;
};

/** Explicit server obligations supply counterparties. A net never supplies a recipient. */
export function ObligationRows({
  scope,
  space,
  viewer,
  obligations,
  eligible,
  showSource = false,
}: {
  showSource?: boolean;
  scope: FinancialScope;
  space: SpaceRoute & { name: string; currency: string };
  viewer: string;
  obligations: readonly BalanceObligation[];
  eligible: (id: string) => boolean;
}) {
  return obligations.map((obligation) => {
    const { from, to, amountMinor } = obligation;
    const canRecord = eligible(from.id) && eligible(to.id);
    const sender =
      from.id === viewer ? `You (${from.displayName})` : from.displayName;
    const recipient =
      to.id === viewer ? `You (${to.displayName})` : to.displayName;
    const label = `Record repayment: ${sender} pays ${recipient} · ${space.name} · ${money(amountMinor)} ${space.currency}`;
    const row = (
      <div data-ui="repayment-row">
        <Member
          name={
            from.id === viewer
              ? to.displayName
              : to.id === viewer
                ? from.displayName
                : `${from.displayName} → ${to.displayName}`
          }
          detail={`${from.id === viewer ? 'You owe' : to.id === viewer ? 'Owes you' : 'Between other members'}${showSource ? ` · ${space.name}` : ''}`}
        />
        <Money
          value={money(amountMinor)}
          currency={space.currency}
          focusable={false}
        />
        {canRecord ? (
          <span aria-hidden="true">›</span>
        ) : (
          <span>Recording requires two currently eligible members.</span>
        )}
      </div>
    );
    return canRecord ? (
      <ScopedLink
        key={`${from.id}:${to.id}`}
        className={styles.obligation}
        aria-label={label}
        scope={scope}
        id={`repay-${space.id}-${from.id}-${to.id}`}
        href={spaceRepaymentHref(
          space,
          new URLSearchParams({
            sender: from.id,
            recipient: to.id,
            amount: amountMinor,
          }),
        )}
      >
        {row}
      </ScopedLink>
    ) : (
      <div
        className={styles.ineligible}
        role="group"
        key={`${from.id}:${to.id}`}
        aria-label={label.replace('Record repayment: ', '')}
      >
        {row}
      </div>
    );
  });
}
