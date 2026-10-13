'use client';
import { useExpenseEntry } from '@/components/expenses/entry';
import workspaceStyles from '../workspace/patterns.module.css';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { fetchQuery } from 'relay-runtime';
import document, {
  type householdAccessQuery,
} from '@/lib/relay/__generated__/householdAccessQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { AppIcon } from '@/components/workspace-identity';
import { useForegroundRefresh } from './foreground';

/** The banner resolves a real source before entering the existing creation flow. */
export function HouseholdBannerAction({ scope }: { scope: FinancialScope }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const expenseEntry = useExpenseEntry();
  const [source, setSource] = useState<string>();
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const invalidate = () => {
    generation.current++;
    request.current?.unsubscribe();
    setSource(undefined);
    setFailed(false);
  };
  useForegroundRefresh(invalidate, () => setVersion((v) => v + 1));
  useEffect(() => {
    const refresh = () => {
      generation.current++;
      request.current?.unsubscribe();
      setSource(undefined);
      setFailed(false);
      setVersion((v) => v + 1);
    };
    window.addEventListener('workspace-refresh-request', refresh);
    return () =>
      window.removeEventListener('workspace-refresh-request', refresh);
  }, []);
  useEffect(() => {
    let active = true;
    const ticket = ++generation.current;
    const live = () =>
      active && scope.isLive() && ticket === generation.current;
    request.current = fetchQuery<householdAccessQuery>(
      scope.environment,
      document,
      {},
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next: (result) => {
        if (!live()) return;
        const homes =
          result.viewer?.__typename === 'Viewer'
            ? result.viewer.groups.filter((g) => g.isHousehold)
            : [];
        setSource(homes.length === 1 ? homes[0].id : undefined);
        setFailed(homes.length !== 1);
      },
      error: () => {
        if (live()) {
          setSource(undefined);
          setFailed(true);
        }
      },
    });
    return () => {
      active = false;
      request.current?.unsubscribe();
    };
  }, [scope, version]);
  if (!source)
    return (
      <span
        id="workspace-add"
        data-ui="banner-action"
        className={workspaceStyles['banner-action']}
        aria-disabled="true"
        title={
          failed
            ? 'Household access is unavailable'
            : 'Checking Household access'
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
  next.set('create', source);
  return (
    <Link
      onClick={(event) => expenseEntry?.activate(event, source)}
      id="workspace-add"
      scroll={false}
      data-ui="banner-action"
      className={workspaceStyles['banner-action']}
      href={`/household/expenses?${next}`}
    >
      <AppIcon name="plus" /> Add expense
    </Link>
  );
}
