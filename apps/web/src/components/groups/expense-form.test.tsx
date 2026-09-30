// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ExpenseForm } from './expense-form';
import { createScope } from '@/lib/relay/environment';
import {
  createInput,
  newDraft,
  readDraft,
  saveDraft,
  privateStorageKey,
} from '@/lib/relay/draft';
import type { SupabaseClient } from '@supabase/supabase-js';
const network = vi.hoisted(() => ({ mutate: vi.fn(), recover: vi.fn() }));
vi.mock('relay-runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  commitMutation: (...args: unknown[]) => network.mutate(...args),
  fetchQuery: () => ({ toPromise: network.recover }),
}));
const group = 'ks1:Group:00000000-0000-4000-8000-000000000001';
const members = [
  {
    id: 'ks1:Membership:00000000-0000-4000-8000-000000000001',
    displayName: 'Alice',
    canParticipate: true,
  },
];
const valid = () => ({
  ...newDraft('2026-09-30', members[0].id, members),
  description: 'Lunch',
  amount: '10.01',
});
let scope: ReturnType<typeof createScope>, root: Root, host: HTMLDivElement;
const committed = vi.fn(async () => {});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    fn();
    return 1;
  });
  scope = createScope({} as SupabaseClient, 'alice');
  saveDraft({ version: 1, actor: 'alice', group, draft: valid() });
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
async function render() {
  await act(async () =>
    root.render(
      <ExpenseForm
        scope={scope}
        group={group}
        today="2026-09-30"
        payer={members[0].id}
        members={members}
        onCommitted={committed}
      />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  )!;
}
function unknownAttempt() {
  const draft = valid();
  const attempt = createInput(draft, members, group, crypto.randomUUID());
  saveDraft({ version: 1, actor: scope.actor, group, draft, attempt });
  return attempt;
}
it('persists the key and original inputs before dispatch and suppresses double submit', async () => {
  network.mutate.mockImplementation((_environment, options) => {
    expect(readDraft('alice', group)?.attempt).toEqual(options.variables.input);
  });
  await render();
  await act(async () => {
    button('Save expense').click();
    button('Save expense').click();
  });
  expect(network.mutate).toHaveBeenCalledTimes(1);
  expect(readDraft('alice', group)?.attempt?.totalMinor).toBe('1001');
});
it('keeps frozen scope/key/input after NOT_OBSERVED and retries without a new key', async () => {
  const attempt = unknownAttempt();
  network.recover.mockResolvedValue({
    expenseOperation: {
      __typename: 'OperationProgress',
      key: attempt.key,
      state: 'NOT_OBSERVED',
    },
  });
  network.mutate.mockImplementation((_environment, options) =>
    options.onError(new Error('Lost response')),
  );
  await render();
  await act(async () => button('Recover original result').click());
  expect(readDraft('alice', group)?.attempt).toEqual(attempt);
  expect(
    (host.querySelector('#expense-description') as HTMLInputElement).disabled ||
      host.querySelector('fieldset')!.disabled,
  ).toBe(true);
  await act(async () => button('Retry original expense').click());
  expect(network.mutate.mock.calls[0][1].variables.input).toEqual(attempt);
});
it('clears a confirmed attempt and requests complete balances exactly once', async () => {
  const attempt = unknownAttempt();
  network.recover.mockResolvedValue({
    expenseOperation: {
      __typename: 'ExpenseCommitted',
      key: attempt.key,
      record: {
        groupId: group,
        expenseId: 'expense-original',
        totalMinor: '1001',
        revision: '5',
      },
    },
  });
  await render();
  await act(async () => button('Recover original result').click());
  expect(readDraft('alice', group)).toBeUndefined();
  expect(committed).toHaveBeenCalledWith('expense-original');
});
it('hides original financial inputs and blocks retry when current access is denied', async () => {
  unknownAttempt();
  network.recover.mockResolvedValue({
    expenseOperation: {
      __typename: 'Problem',
      code: 'NOT_FOUND',
      message: 'Unavailable',
    },
  });
  await render();
  await act(async () => button('Recover original result').click());
  expect(host.querySelector('form')).toBeNull();
  expect(button('Retry original expense').disabled).toBe(true);
  expect(readDraft('alice', group)?.attempt).toBeDefined();
});
it('does not apply a late recovery after navigation/unmount', async () => {
  const attempt = unknownAttempt();
  let finish!: (result: unknown) => void;
  network.recover.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await render();
  await act(async () => button('Recover original result').click());
  await act(async () => root.render(null));
  await act(async () =>
    finish({
      expenseOperation: {
        __typename: 'ExpenseCommitted',
        key: attempt.key,
        record: { groupId: group, expenseId: 'old', totalMinor: '1001' },
      },
    }),
  );
  expect(committed).not.toHaveBeenCalled();
  expect(readDraft('alice', group)?.attempt).toEqual(attempt);
});
it('blocks malformed stored shapes and never replaces an unknown attempt', async () => {
  sessionStorage.setItem(
    privateStorageKey,
    JSON.stringify({
      [group]: { version: 1, actor: 'alice', group, draft: {}, attempt: {} },
    }),
  );
  await render();
  expect(host.textContent).toContain('saved draft cannot be read');
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  expect(network.mutate).not.toHaveBeenCalled();
});
it('does not send when storage fails before first submission', async () => {
  await render();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  await act(async () => button('Save expense').click());
  expect(network.mutate).not.toHaveBeenCalled();
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
});
