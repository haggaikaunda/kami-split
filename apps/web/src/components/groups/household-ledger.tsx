'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchQuery } from 'relay-runtime';
import document, {
  type journeyViewerQuery,
} from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { useFinancialSession } from './session';
import { GroupJourney } from './journey';
import { WorkspaceRefresh } from '@/components/workspace-refresh';
import { Skeleton } from '@/components/primitives';
import { useForegroundRefresh } from './foreground';
/** Resolve the original ledger from fresh authorized metadata, never a supplied ID. */
export function HouseholdLedger() {
  const access = useFinancialSession();
  const params = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete('source');
  next.delete('restore');
  if (access.loading) return <Skeleton label="Loading Household" />;
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
  const [home, setHome] = useState('');
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const request = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const invalidate = () => {
    generation.current++;
    request.current?.unsubscribe();
    setHome('');
    setError(false);
  };
  useForegroundRefresh(invalidate, () => setVersion((v) => v + 1));
  useEffect(() => {
    const ticket = ++generation.current;
    let active = true;
    request.current = fetchQuery<journeyViewerQuery>(
      scope.environment,
      document,
      {},
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next: (result) => {
        if (!active || !scope.isLive() || ticket !== generation.current) return;
        const homes =
          result.viewer.__typename === 'Viewer'
            ? result.viewer.groups.filter((g) => g.isHousehold)
            : [];
        if (homes.length === 1) setHome(homes[0].id);
        else setError(true);
      },
      error: () => {
        if (active && scope.isLive() && ticket === generation.current)
          setError(true);
      },
    });
    return () => {
      active = false;
      request.current?.unsubscribe();
    };
  }, [scope, version]);
  if (error)
    return (
      <>
        <p role="alert">
          Household ledger access is unavailable. Refresh to check current
          access.
        </p>
        <WorkspaceRefresh
          busy={false}
          error="Access unavailable"
          onRefresh={() => {
            invalidate();
            setVersion((v) => v + 1);
          }}
        />
      </>
    );
  if (!home || !scope.isLive())
    return <Skeleton label="Loading Household ledger" />;
  return (
    <GroupJourney
      key={`${scope.id}:${home}:${params.toString()}`}
      household
      initialGroup={home}
      expense={params.get('expense') ?? ''}
      repayment={params.get('repayment') === '1'}
    />
  );
}
