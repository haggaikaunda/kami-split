'use client';

import { useState, type ReactNode } from 'react';
import type { FinancialScope } from '@/lib/relay/environment';
import { money } from '@/lib/relay/money';
import { spaceRepaymentHref, type SpaceRoute } from '@/lib/relay/space-routes';
import { RecommendedRepaymentRow } from '../financial/presentation';
import { ScopedLink } from './navigation';
import styles from './balance-sections.module.css';

/** Native keyboard disclosure; only open/closed metadata survives authorized remounts. */
export function BalanceSection({
  scope,
  identity,
  summary,
  children,
  initiallyOpen = false,
}: {
  scope: FinancialScope;
  identity: string;
  summary: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(
    () => scope.balanceExpansions?.get(identity) ?? initiallyOpen,
  );
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
      }}
    >
      <summary id={`balance-section-${identity}`} aria-expanded={open}>
        {summary}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
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
}: {
  scope: FinancialScope;
  space: SpaceRoute & { name: string; currency: string };
  viewer: string;
  obligations: readonly BalanceObligation[];
  eligible: (id: string) => boolean;
}) {
  return obligations.map((obligation) => {
    const { from, to, amountMinor } = obligation;
    const canRecord = eligible(from.id) && eligible(to.id);
    const row = (
      <RecommendedRepaymentRow
        linked={canRecord}
        group={space.name}
        sender={
          from.id === viewer ? `You (${from.displayName})` : from.displayName
        }
        recipient={
          to.id === viewer ? `You (${to.displayName})` : to.displayName
        }
        value={money(amountMinor)}
        currency={space.currency}
        action={
          canRecord ? (
            <span aria-hidden="true">→</span>
          ) : (
            <span>Recording requires two currently eligible members.</span>
          )
        }
      />
    );
    return canRecord ? (
      <ScopedLink
        key={`${from.id}:${to.id}`}
        className={styles.obligation}
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
        aria-label={`Record repayment: ${from.displayName} paid ${to.displayName}, ${money(amountMinor)} ${space.currency}, ${space.name}`}
      >
        {row}
      </ScopedLink>
    ) : (
      <div className={styles.ineligible} key={`${from.id}:${to.id}`}>
        {row}
      </div>
    );
  });
}
