// @vitest-environment jsdom
import { act } from 'react';
import { foregroundRefresh } from '../workspace-refresh.test-utils';
import { createRoot } from 'react-dom/client';
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
} from 'relay-runtime';
import { expect, it, vi } from 'vitest';
import { HouseholdRead } from './household-workspace';
import type { FinancialScope } from '@/lib/relay/environment';
import type { OnboardingController } from '../onboarding/controller';
const state = vi.hoisted(() => ({ current: {} as OnboardingController }));
vi.mock('../onboarding/controller', () => ({
  useOnboarding: () => state.current,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: 'a',
}));
it('foreground refresh reauthorizes membership and reconciles accepted reactivation without stale or duplicate people', async () => {
  const requests: { name: string; next(data: unknown): void }[] = [];
  const environment = new Environment({
    network: Network.create((operation) =>
      Observable.create((sink) => {
        requests.push({
          name: operation.name,
          next: (data) => sink.next({ data } as never),
        });
      }),
    ),
    store: new Store(new RecordSource()),
  });
  const scope = {
    id: 'scope',
    actor: 'alice',
    environment,
    isLive: () => true,
  } as FinancialScope;
  const invite = {
    id: 'invite-b',
    kind: 'TARGETED',
    recipient: 'bob@example.test',
    lifecycle: 'PENDING',
    expiresAt: '2099-01-01T00:00:00Z',
    delivery: 'PROVIDER_ACCEPTED',
    actionID: null,
  };
  state.current = {
    loading: false,
    session: { user: { id: 'alice' } },
    group: 'H',
    setGroup: vi.fn(),
    loadInvites: vi.fn(),
    run: async (f: () => Promise<void>) => f(),
    invites: [invite],
  } as unknown as OnboardingController;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const access = {
    viewer: {
      __typename: 'Viewer',
      id: 'viewer',
      groups: [{ id: 'H', isHousehold: true }],
    },
  };
  const membership = (status: string) => ({
    group: {
      __typename: 'Group',
      id: 'H',
      name: 'Household',
      viewerMembership: { id: 'a', role: 'OWNER' },
      members: [
        { id: 'a', displayName: 'Alice', role: 'OWNER', status: 'ACTIVE' },
        { id: 'b', displayName: 'Bob', role: 'MEMBER', status },
      ],
    },
  });
  try {
    await act(async () =>
      root.render(<HouseholdRead scope={scope} current="Members" />),
    );
    await act(async () => requests[0].next(access));
    await act(async () => requests[1].next(membership('INACTIVE')));
    expect(host.querySelector('[aria-label="People"]')?.children).toHaveLength(
      3,
    );
    expect(host.textContent).toContain('Inactive');
    state.current = {
      ...state.current,
      invites: [{ ...invite, lifecycle: 'ACCEPTED' }],
    };
    await foregroundRefresh();
    expect(requests[2].name).toBe('householdAccessQuery');
    expect(host.textContent).not.toContain('Bob');
    await act(async () => requests[2].next(access));
    expect(requests[3].name).toBe('householdMembersQuery');
    await act(async () => requests[3].next(membership('ACTIVE')));
    const people = host.querySelector('[aria-label="People"]')!;
    expect(people.children).toHaveLength(2);
    expect(people.textContent).toContain('Bob');
    expect(people.textContent).not.toContain('Inactive');
    expect(people.textContent).not.toContain('bob@example.test');
    expect(
      host.querySelector('[data-ui~="invitation-history"]')?.textContent,
    ).toContain('Accepted');
    expect(state.current.loadInvites).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
