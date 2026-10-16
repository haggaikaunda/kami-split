'use client';
import { useEffect, useEffectEvent, type ReactNode } from 'react';
import { NetworkQuery } from '@/lib/relay/query';
import document, {
  type householdAccessQuery,
} from '@/lib/relay/__generated__/householdAccessQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';

/** A Household source is resolved from current access, never from URL input. */
export function HouseholdAccess({
  scope,
  fallback,
  failure,
  children,
  onDenied,
  onState,
  reuse = true,
}: {
  reuse?: boolean;
  scope: FinancialScope;
  fallback: ReactNode;
  failure: ReactNode;
  children: (id: string) => ReactNode;
  onDenied?: () => void;
  onState?: (state: { busy: boolean; error: boolean }) => void;
}) {
  return (
    <NetworkQuery<householdAccessQuery>
      reuse={reuse}
      scope={scope}
      document={document}
      variables={{}}
      fallback={fallback}
      failure={failure}
      onState={onState}
    >
      {(result) => {
        const homes =
          result.viewer.__typename === 'Viewer'
            ? result.viewer.groups.filter((group) => group.isHousehold)
            : [];
        return homes.length === 1 ? (
          children(homes[0].id)
        ) : (
          <AccessUnavailable onDenied={onDenied}>{failure}</AccessUnavailable>
        );
      }}
    </NetworkQuery>
  );
}
function AccessUnavailable({
  onDenied,
  children,
}: {
  onDenied?: () => void;
  children: ReactNode;
}) {
  const deny = useEffectEvent(() => onDenied?.());
  useEffect(() => {
    deny();
  }, []);
  return children;
}
