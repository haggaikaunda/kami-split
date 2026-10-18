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
  groupCreationStorageKey,
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
function edit(id: string, value: string) {
  const input = host.querySelector(`#creation-${id}`) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
it('defaults entry types and UTC dates, has no member picker or editable currency', async () => {
  await render('TRIP');
  expect(
    (host.querySelector('#creation-kind') as HTMLSelectElement).value,
  ).toBe('TRIP');
  expect(
    (host.querySelector('#creation-startDate') as HTMLInputElement).value,
  ).toBe('2026-10-04');
  expect(host.querySelectorAll('select')).toHaveLength(1);
  expect(host.textContent).toContain('Currency: USD');
  expect(
    (host.querySelector('#creation-currency') as HTMLInputElement).readOnly,
  ).toBe(true);
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
  expect(host.querySelector('details')?.open).toBe(false);
  expect(button('Create trip').disabled).toBe(false);
  await render('ORDINARY', 'ordinary');
  expect(host.querySelector('#creation-startDate')).toBeNull();
});
it('persists key/frozen canonical input before dispatch and suppresses double click', async () => {
  network.mutate.mockImplementation((_env, options) =>
    expect(readCreation('Viewer:A')?.attempt).toEqual(options.variables.input),
  );
  await render();
  await act(async () => {
    edit('name', ' \tFriends\n');
  });
  await act(async () => {
    button('Create group').click();
    button('Create group').click();
  });
  expect(network.mutate).toHaveBeenCalledTimes(1);
  expect(readCreation('Viewer:A')?.attempt).toMatchObject({
    name: 'Friends',
    kind: 'ORDINARY',
    trip: null,
  });
});
it('reloads lost-response input and NOT_STARTED retries the same key despite changed entry defaults', async () => {
  const a = frozen();
  network.read.mockResolvedValue({
    groupCreationOperation: {
      __typename: 'GroupCreationNotStarted',
      operationKey: a.operationKey,
    },
  });
  network.mutate.mockImplementation((_env, options) =>
    options.onError(new Error('Lost response')),
  );
  await render();
  await act(async () => button('Check creation').click());
  expect(host.textContent).toContain('may still commit');
  await act(async () => button('Retry original creation').click());
  await render('ORDINARY', 'reload');
  await act(async () => button('Retry original creation').click());
  expect(network.mutate.mock.calls.map((c) => c[1].variables.input)).toEqual([
    a,
    a,
  ]);
  expect((host.querySelector('#creation-name') as HTMLInputElement).value).toBe(
    draft.name.replace(/[\r\n]/g, ''),
  );
});
it('keeps changed-input conflicts locked and never allocates another key', async () => {
  const a = frozen();
  network.mutate.mockImplementation((_env, o) =>
    o.onCompleted(
      {
        createGroup: {
          __typename: 'GroupCreationConflict',
          operationKey: a.operationKey,
        },
      },
      null,
    ),
  );
  await render();
  await act(async () => button('Retry original creation').click());
  expect(host.textContent).toContain('different input');
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  expect(button('Create trip').closest('fieldset')!.disabled).toBe(true);
});
it('definitive rejection enables correction with a new attempt key and field errors', async () => {
  const a = frozen();
  network.read.mockResolvedValue({
    groupCreationOperation: {
      __typename: 'GroupCreationRejected',
      operationKey: a.operationKey,
      fields: [{ path: ['name'], message: 'Use another name' }],
    },
  });
  await render();
  await act(async () => button('Check creation').click());
  expect(readCreation('Viewer:A')?.attempt).toBeUndefined();
  expect(host.textContent).toContain('Use another name');
  await act(async () => {
    edit('name', 'New name');
  });
  await act(async () => button('Create trip').click());
  expect(network.mutate.mock.calls[0][1].variables.input.operationKey).not.toBe(
    a.operationKey,
  );
});
it.each(['ORDINARY', 'TRIP'] as const)(
  'freshly authorizes completed %s before its canonical route and clears only confirmed accessible results',
  async (kind) => {
    const a = frozen();
    network.read
      .mockResolvedValueOnce({ groupCreationOperation: completed(a) })
      .mockResolvedValueOnce(fresh);
    await render(kind);
    await act(async () => button('Check creation').click());
    expect(network.read.mock.calls[1][2]).toEqual({ id: 'G' });
    expect(network.read.mock.calls[1][3]).toEqual({
      fetchPolicy: 'network-only',
    });
    expect(network.push).toHaveBeenCalledWith('/trips/G');
    expect(readCreation('Viewer:A')).toBeUndefined();
  },
);
it('read failure never shows false empty/zero or opens the group; recovery stays available', async () => {
  const a = frozen();
  network.read
    .mockResolvedValueOnce({ groupCreationOperation: completed(a) })
    .mockResolvedValueOnce({ group: null });
  await render();
  await act(async () => button('Check creation').click());
  expect(network.push).not.toHaveBeenCalled();
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  expect(host.textContent).toContain('No empty ledger or zero balance');
});
it.each(['NOT_FOUND', 'FORBIDDEN', 'DISABLED', 'UNAUTHENTICATED'])(
  'hides fields and retains attempts after %s recovery denial',
  async (code) => {
    const a = frozen();
    network.read.mockResolvedValue({
      groupCreationOperation: { __typename: 'Problem', code },
    });
    await render();
    await act(async () => button('Check creation').click());
    expect(denied).toHaveBeenCalledOnce();
    expect(host.querySelector('form')).toBeNull();
    expect(button('Retry original creation').disabled).toBe(true);
    expect(readCreation('Viewer:A')?.attempt).toEqual(a);
  },
);
it('access loss during the fresh completed-group read hides fields and blocks opening', async () => {
  const a = frozen();
  network.read
    .mockResolvedValueOnce({ groupCreationOperation: completed(a) })
    .mockResolvedValueOnce({
      group: { __typename: 'Problem', code: 'NOT_FOUND' },
    });
  await render();
  await act(async () => button('Check creation').click());
  expect(denied).toHaveBeenCalledOnce();
  expect(network.push).not.toHaveBeenCalled();
});
it('leaving during mutation or fresh read never redirects or clears the original attempt', async () => {
  const a = frozen();
  await render();
  await act(async () => button('Retry original creation').click());
  const options = network.mutate.mock.calls[0][1];
  await act(async () => root.render(<p>Other group</p>));
  await act(async () =>
    options.onCompleted({ createGroup: completed(a) }, null),
  );
  expect(network.push).not.toHaveBeenCalled();
  expect(network.read).not.toHaveBeenCalled();
  expect(readCreation('Viewer:A')?.attempt).toEqual(a);
});
it('actor replacement suppresses late results before any group read', async () => {
  const a = frozen();
  await render();
  await act(async () => button('Retry original creation').click());
  scope.dispose();
  await act(async () =>
    network.mutate.mock.calls[0][1].onCompleted(
      { createGroup: completed(a) },
      null,
    ),
  );
  expect(network.push).not.toHaveBeenCalled();
  expect(network.read).not.toHaveBeenCalled();
});
it('focuses invalid fields and shows accessible errors without a network request', async () => {
  await render();
  await act(async () => button('Create group').click());
  expect(document.activeElement?.id).toBe('creation-name');
  expect(
    host.querySelector('#creation-name')?.getAttribute('aria-invalid'),
  ).toBe('true');
  expect(network.mutate).not.toHaveBeenCalled();
});
it('blocks corrupted storage and offers inspection before explicit new creation', async () => {
  sessionStorage.setItem(groupCreationStorageKey, 'bad');
  await render();
  expect(button('Create group').closest('fieldset')!.disabled).toBe(true);
  expect(host.textContent).toContain('may have completed');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/groups');
  await act(async () =>
    (host.querySelector('input[type=checkbox]') as HTMLInputElement).click(),
  );
  await act(async () => button('Start new draft after storage loss').click());
  expect(button('Create group').closest('fieldset')!.disabled).toBe(false);
  expect(network.mutate).not.toHaveBeenCalled();
});
it('unwritable storage sends nothing', async () => {
  await render();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await act(async () => {
    edit('name', 'Friends');
  });
  await act(async () => button('Create group').click());
  expect(network.mutate).not.toHaveBeenCalled();
});

it('persists a pre-submit type change and preserves its recovered identity and dates', async () => {
  await render();
  const select = host.querySelector('#creation-kind') as HTMLSelectElement;
  await act(async () => {
    select.value = 'TRIP';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    edit('name', 'Spring trip');
  });
  await render('ORDINARY', 'reloaded');
  expect(
    (host.querySelector('#creation-kind') as HTMLSelectElement).value,
  ).toBe('TRIP');
  expect((host.querySelector('#creation-name') as HTMLInputElement).value).toBe(
    'Spring trip',
  );
  expect(
    (host.querySelector('#creation-startDate') as HTMLInputElement).value,
  ).toBe('2026-10-04');
});
