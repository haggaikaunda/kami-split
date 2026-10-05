// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScope } from '@/lib/relay/environment';
import {
  creationInput,
  readCreation,
  saveCreation,
  type CreationDraft,
} from '@/lib/relay/group-creation';
import { CreationForm } from './creation-form';
const network = vi.hoisted(() => ({
  mutate: vi.fn(),
  read: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: network.push }),
}));
vi.mock('relay-runtime', async (original) => ({
  ...(await original<object>()),
  commitMutation: (...args: unknown[]) => network.mutate(...args),
  fetchQuery: (...args: unknown[]) => ({
    toPromise: () => network.read(...args),
  }),
}));
let root: Root, host: HTMLDivElement, scope: ReturnType<typeof createScope>;
const denied = vi.fn();
const draft: CreationDraft = {
  name: ' \tTrip\n',
  kind: 'TRIP',
  destination: '  Kyoto  ',
  startDate: '2026-10-04',
  endDate: '2026-10-05',
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    fn();
    return 1;
  });
  scope = createScope({} as SupabaseClient, 'auth-a');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  scope.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(kind: 'TRIP' | 'ORDINARY' = 'ORDINARY', key = 'visit') {
  await act(async () =>
    root.render(
      <CreationForm
        key={key}
        scope={scope}
        actor="Viewer:A"
        today="2026-10-04"
        kind={kind}
        onDenied={denied}
      />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
}
function frozen() {
  const attempt = creationInput(draft, crypto.randomUUID());
  saveCreation({ version: 1, actor: 'Viewer:A', draft, attempt });
  return attempt;
}
function completed(a: ReturnType<typeof frozen>) {
  return {
    __typename: 'GroupCreationCompleted',
    operationKey: a.operationKey,
    groupId: 'G',
    creatorMembershipId: 'M',
    createdAt: '2026-10-04T00:00:00Z',
  };
}
const fresh = {
  group: {
    __typename: 'Group',
    id: 'G',
    expenses: { edges: [] },
    balances: { __typename: 'GroupBalances' },
  },
};
it('does not redirect or clear recovery when leaving during the fresh completed-group read', async () => {
  const a = frozen();
  let resolveRead!: (value: typeof fresh) => void;
  network.read
    .mockResolvedValueOnce({ groupCreationOperation: completed(a) })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
  await render();
  await act(async () => button('Check creation').click());
  expect(network.read).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<p>Another group</p>));
  await act(async () => resolveRead(fresh));
  expect(network.push).not.toHaveBeenCalled();
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
});
it('retains the original attempt on unavailable recovery or mismatched operation identity', async () => {
  const a = frozen();
  network.read
    .mockResolvedValueOnce({
      groupCreationOperation: { __typename: 'Problem', code: 'UNAVAILABLE' },
    })
    .mockResolvedValueOnce({
      groupCreationOperation: {
        ...completed(a),
        operationKey: crypto.randomUUID(),
      },
    });
  await render();
  await act(async () => button('Check creation').click());
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  await act(async () => button('Check creation').click());
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  expect(network.push).not.toHaveBeenCalled();
  expect(network.mutate).not.toHaveBeenCalled();
  expect(network.read).toHaveBeenCalledTimes(2);
});
it('does not lose rejected-attempt identity if writing the corrected draft fails', async () => {
  const a = frozen();
  network.read.mockResolvedValue({
    groupCreationOperation: {
      __typename: 'GroupCreationRejected',
      operationKey: a.operationKey,
      fields: [{ path: ['name'], message: 'Rejected' }],
    },
  });
  await render();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await act(async () => button('Check creation').click());
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  expect(network.mutate).not.toHaveBeenCalled();
  expect(button('Retry original creation').disabled).toBe(true);
});
it('hidden-tab completion retains its original attempt and does not redirect', async () => {
  const a = frozen();
  await render();
  await act(async () => button('Retry original creation').click());
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () =>
    network.mutate.mock.calls[0][1].onCompleted(
      { createGroup: completed(a) },
      null,
    ),
  );
  expect(network.push).not.toHaveBeenCalled();
  expect(network.read).not.toHaveBeenCalled();
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
});
it('hiding during the fresh completed-group read preserves recovery without navigation', async () => {
  const a = frozen();
  let resolveRead!: (value: typeof fresh) => void;
  network.read
    .mockResolvedValueOnce({ groupCreationOperation: completed(a) })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
  await render();
  await act(async () => button('Check creation').click());
  expect(network.read).toHaveBeenCalledTimes(2);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => resolveRead(fresh));
  expect(network.push).not.toHaveBeenCalled();
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
});
