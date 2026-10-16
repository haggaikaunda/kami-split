'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HouseholdAccess } from './household-access';
import type { FinancialScope } from '@/lib/relay/environment';
import { useFinancialSession } from './session';
import { GroupJourney } from './journey';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { Skeleton } from '../ui/primitives';
import { useForegroundRefresh } from './foreground';
/** Resolve the original ledger from fresh authorized metadata, never a supplied ID. */
export function HouseholdLedger() {
  const access = useFinancialSession();
  const params = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete('source');
  next.delete('restore');
  if (access.loading)
    return <Skeleton size="workspace" label="Loading Household" />;
  if (access.error) return <p role="alert">{access.error}</p>;
  if (!access.scope)
    return (
      <p>
        <Link
          href={`/sign-in?next=${encodeURIComponent('/household/ledger?' + next)}`}
        >
          Sign in
        </Link>{' '}
        to open your Household ledger.
      </p>
    );
  return <LedgerRead key={access.scope.id} scope={access.scope} />;
}
function LedgerRead({ scope }: { scope: FinancialScope }) {
  const params = useSearchParams();
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  const reset = () => {
    setVersion((v) => v + 1);
    setActive(true);
  };
  useForegroundRefresh(() => setActive(false), reset);
  const failure = (
    <>
      <p role="alert">
        Household ledger access is unavailable. Refresh to check current access.
      </p>
      <WorkspaceRefresh
        busy={false}
        error="Access unavailable"
        onRefresh={reset}
      />
    </>
  );
  const loading = (
    <Skeleton size="workspace" label="Loading Household ledger" />
  );
  return active ? (
    <HouseholdAccess
      reuse={version === 0}
      key={version}
      scope={scope}
      fallback={loading}
      failure={failure}
    >
      {(home) => (
        <GroupJourney
          key={`${scope.id}:${home}:${params.toString()}`}
          household
          initialGroup={home}
          expense={params.get('expense') ?? ''}
          repayment={params.get('repayment') === '1'}
        />
      )}
    </HouseholdAccess>
  ) : (
    loading
  );
}
