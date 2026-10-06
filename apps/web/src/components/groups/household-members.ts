import { useEffect, useRef, useState } from 'react';
import { fetchQuery } from 'relay-runtime';
import accessDocument, {
  type householdAccessQuery,
} from '@/lib/relay/__generated__/householdAccessQuery.graphql';
import membersDocument, {
  type householdMembersQuery,
} from '@/lib/relay/__generated__/householdMembersQuery.graphql';
import type { FinancialScope } from '@/lib/relay/environment';
import { useForegroundRefresh } from './foreground';
type Members = Extract<
  householdMembersQuery['response']['group'],
  { readonly __typename: 'Group' }
>;
/** Reads the actual Household membership without aggregate financial readiness. */
export function useHouseholdMembers(scope: FinancialScope) {
  const [members, setMembers] = useState<Members>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const requests = useRef<{ unsubscribe(): void }[]>([]);
  const invalidate = () => {
    generation.current++;
    requests.current.forEach((r) => r.unsubscribe());
    requests.current = [];
    setMembers(undefined);
    setError('');
  };
  const reset = () => {
    invalidate();
    setVersion((v) => v + 1);
  };
  useForegroundRefresh(invalidate, () => setVersion((v) => v + 1));
  useEffect(() => {
    let active = true;
    const ticket = ++generation.current;
    let memberRead: { unsubscribe(): void } | undefined;
    const failed = () => {
      if (active && scope.isLive() && ticket === generation.current)
        setError(
          'Household membership is unavailable. Refresh to check current access.',
        );
    };
    const request = fetchQuery<householdAccessQuery>(
      scope.environment,
      accessDocument,
      {},
      { fetchPolicy: 'network-only' },
    ).subscribe({
      next: (result) => {
        if (!active || !scope.isLive() || ticket !== generation.current) return;
        const homes =
          result.viewer?.__typename === 'Viewer'
            ? result.viewer.groups.filter((s) => s.isHousehold)
            : [];
        const home = homes.length === 1 ? homes[0] : undefined;
        if (!home) {
          failed();
          return;
        }
        memberRead = fetchQuery<householdMembersQuery>(
          scope.environment,
          membersDocument,
          { id: home.id },
          { fetchPolicy: 'network-only' },
        ).subscribe({
          next: (response) => {
            if (!active || !scope.isLive() || ticket !== generation.current)
              return;
            if (
              response.group?.__typename === 'Group' &&
              response.group.id === home.id
            )
              setMembers(response.group);
            else failed();
          },
          error: failed,
        });
        requests.current.push(memberRead);
      },
      error: failed,
    });
    requests.current.push(request);
    return () => {
      active = false;
      request.unsubscribe();
      memberRead?.unsubscribe();
    };
  }, [scope, version]);
  return { members, error, reset };
}
