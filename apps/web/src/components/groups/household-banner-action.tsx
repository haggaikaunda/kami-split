'use client';
import { useExpenseEntry } from '@/components/expenses/entry';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { HouseholdAccess } from './household-access';
import type { FinancialScope } from '@/lib/relay/environment';
import { AppIcon } from '@/components/workspace-identity';
import { useForegroundRefresh } from './foreground';
import workspaceStyles from '../workspace/patterns.module.css';

/** The banner resolves a real source before entering the existing creation flow. */
export function HouseholdBannerAction({ scope }: { scope: FinancialScope }) {
  const pathname = usePathname();
  const expenseEntry = useExpenseEntry();
  const params = useSearchParams();
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const invalidate = () => setActive(false);
  const refresh = () => {
    setVersion((v) => v + 1);
    setActive(true);
  };
  useForegroundRefresh(invalidate, refresh);
  useEffect(() => {
    window.addEventListener('workspace-refresh-request', refresh);
    return () =>
      window.removeEventListener('workspace-refresh-request', refresh);
  }, []);
  const disabled = (failed: boolean) => (
    <span
      id="workspace-add"
      data-ui="banner-action"
      className={workspaceStyles['banner-action']}
      aria-disabled="true"
      title={
        failed ? 'Household access is unavailable' : 'Checking Household access'
      }
    >
      <AppIcon name="plus" /> Add expense
    </span>
  );
  const next =
    pathname === '/household/expenses'
      ? new URLSearchParams(params)
      : new URLSearchParams();
  for (const key of ['expense', 'expenseGroup', 'detailSource', 'after'])
    next.delete(key);
  return active ? (
    <HouseholdAccess
      key={version}
      scope={scope}
      fallback={disabled(false)}
      failure={disabled(true)}
    >
      {(source) => {
        const destination = new URLSearchParams(next);
        destination.set('create', source);
        return (
          <Link
            id="workspace-add"
            onClick={(event) => expenseEntry?.activate(event, source)}
            scroll={false}
            data-ui="banner-action"
            className={workspaceStyles['banner-action']}
            href={`/household/expenses?${destination}`}
          >
            <AppIcon name="plus" /> Add expense
          </Link>
        );
      }}
    </HouseholdAccess>
  ) : (
    disabled(false)
  );
}
