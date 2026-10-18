'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NetworkQuery } from '@/lib/relay/query';
import type { FinancialScope } from '@/lib/relay/environment';
import { groupRouteId } from '@/lib/relay/discovery';
import document, {
  type profileReturnQuery,
} from '@/lib/relay/__generated__/profileReturnQuery.graphql';
import { SourceReturn } from '../groups/navigation';
import { useForegroundRefresh } from '../groups/foreground';

/** Private source names require a fresh account-scoped authorization response. */
export function ProfileReturn({ scope }: { scope: FinancialScope }) {
  const token = useSearchParams().get('source');
  const visit = token && scope.isLive() ? scope.visits.get(token) : undefined;
  const groupId = visit
    ? groupRouteId(new URL(visit.href, 'https://workspace.invalid').pathname)
    : undefined;
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(true);
  useForegroundRefresh(
    () => setActive(false),
    () => {
      setVersion((value) => value + 1);
      setActive(true);
    },
    Boolean(groupId),
  );
  const fallback = (
    <SourceReturn
      scope={scope}
      authorizedGroups={[]}
      fallbackLabel="Go to Groups"
    />
  );
  const pending = (
    <span data-ui="source-return-pending" role="status">
      Checking return destination…
    </span>
  );
  if (!groupId) return fallback;
  if (!active) return pending;
  return (
    <NetworkQuery<profileReturnQuery>
      key={`${scope.id}:${token}:${version}`}
      scope={scope}
      document={document}
      variables={{}}
      fallback={pending}
      failure={fallback}
    >
      {(data) => (
        <SourceReturn
          scope={scope}
          fallbackLabel="Go to Groups"
          authorizedGroups={
            data.viewer.__typename === 'Viewer' ? data.viewer.groups : []
          }
        />
      )}
    </NetworkQuery>
  );
}
