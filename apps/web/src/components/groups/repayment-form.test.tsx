// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScope } from '@/lib/relay/environment';
import { readRepayment, saveRepayment } from '@/lib/relay/repayment-draft';
import { repaymentStorageKey } from '@/lib/relay/draft';
import { RepaymentForm } from './repayment-form';
const network = vi.hoisted(() => ({ mutate: vi.fn(), recover: vi.fn() }));
vi.mock('relay-runtime', async (original) => ({
  ...(await original<object>()),
  commitMutation: (...args: unknown[]) => network.mutate(...args),
  fetchQuery: () => ({ toPromise: network.recover }),
}));
const members = [
  { id: 'a', displayName: 'Alice', canParticipate: true },
  { id: 'b', displayName: 'Bob', canParticipate: true },
  { id: 'c', displayName: 'Carol', canParticipate: true },
];
let root: Root, host: HTMLDivElement, scope: ReturnType<typeof createScope>;
const committed = vi.fn(async () => {}),
  denied = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    fn();
    return 1;
  });
  scope = createScope({} as SupabaseClient, 'actor-a');
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
async function render(
  group = 'G',
  sender = 'a',
  recipient = 'b',
  suggested = '1001',
) {
  await act(async () =>
    root.render(
      <RepaymentForm
        key={group}
        scope={scope}
        group={group}
        name={group}
        today="2026-10-04"
        sender={sender}
        recipient={recipient}
        suggested={suggested}
        members={members}
        onCommitted={committed}
        onDenied={denied}
      />,
    ),
  );
}
function button(label: string) {
  return [...host.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
}
function frozen() {
  const draft = {
    sender: 'a',
    recipient: 'b',
    amount: '10.01',
    date: '2026-10-04',
    note: '  note  ',
  };
  const attempt = {
    groupId: 'G',
    key: crypto.randomUUID(),
    senderId: 'a',
    recipientId: 'b',
    amountMinor: '1001',
    currency: 'USD' as const,
    effectiveDate: draft.date,
    note: draft.note,
  };
  saveRepayment({ version: 1, actor: 'actor-a', group: 'G', draft, attempt });
  return attempt;
}
function success(a: ReturnType<typeof frozen>) {
  return {
    __typename: 'RepaymentCommitted',
    key: a.key,
    record: {
      repaymentId: 'R',
      groupId: a.groupId,
      senderMembershipId: a.senderId,
      recipientMembershipId: a.recipientId,
      amountMinor: a.amountMinor,
      currency: a.currency,
      effectiveDate: a.effectiveDate,
      note: a.note,
    },
  };
}
it('persists explicit participants/key before dispatch and suppresses duplicate submit', async () => {
  network.mutate.mockImplementation((_env, options) =>
    expect(readRepayment('actor-a', 'G')?.attempt).toEqual(
      options.variables.input,
    ),
  );
  await render();
  await act(async () => {
    button('Record repayment').click();
    button('Record repayment').click();
  });
  expect(network.mutate).toHaveBeenCalledTimes(1);
  expect(readRepayment('actor-a', 'G')?.attempt).toMatchObject({
    groupId: 'G',
    senderId: 'a',
    recipientId: 'b',
    amountMinor: '1001',
  });
});
it('recovers or retries frozen original input after missing/unknown response and changed navigation suggestion', async () => {
  const a = frozen();
  network.recover.mockResolvedValue({
    repaymentOperation: {
      __typename: 'OperationProgress',
      key: a.key,
      state: 'NOT_OBSERVED',
    },
  });
  network.mutate.mockImplementation((_env, options) =>
    options.onError(new Error('Timeout')),
  );
  await render('G', 'c', 'a', '9999');
  await act(async () => button('Recover original repayment').click());
  await act(async () => button('Retry original repayment').click());
  expect(network.mutate.mock.calls[0][1].variables.input).toEqual(a);
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(a);
  expect(
    (host.querySelector('#repayment-recipient') as HTMLSelectElement).value,
  ).toBe('b');
});
it('confirms original result once, clears the attempt and requests a fresh group read', async () => {
  const a = frozen();
  network.recover.mockResolvedValue({ repaymentOperation: success(a) });
  await render();
  await act(async () => button('Recover original repayment').click());
  expect(committed).toHaveBeenCalledTimes(1);
  expect(readRepayment('actor-a', 'G')).toBeUndefined();
  expect(host.textContent).toContain('No money was moved');
});
it('retains wrong-scope or conflicting success instead of treating it as the current repayment', async () => {
  const a = frozen();
  network.recover.mockResolvedValue({
    repaymentOperation: {
      ...success(a),
      record: { ...success(a).record, groupId: 'T' },
    },
  });
  await render();
  await act(async () => button('Recover original repayment').click());
  expect(committed).not.toHaveBeenCalled();
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(a);
});
it('keeps saved attempts separate across groups and ignores delayed completion after navigation', async () => {
  const a = frozen();
  await render();
  await act(async () => button('Retry original repayment').click());
  const options = network.mutate.mock.calls[0][1];
  await render('T', 'b', 'c', '2000');
  await act(async () =>
    options.onCompleted({ recordRepayment: success(a) }, null),
  );
  expect(committed).not.toHaveBeenCalled();
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(a);
  expect(
    (host.querySelector('#repayment-sender') as HTMLSelectElement).value,
  ).toBe('b');
});
it('hides fields and blocks retries on current access denial while retaining recovery scope', async () => {
  const a = frozen();
  network.recover.mockResolvedValue({
    repaymentOperation: {
      __typename: 'Problem',
      code: 'NOT_FOUND',
      message: 'Unavailable',
    },
  });
  await render();
  await act(async () => button('Recover original repayment').click());
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('form')).toBeNull();
  expect(button('Retry original repayment').disabled).toBe(true);
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(a);
});
it('blocks network sends when durable tab storage is malformed or unwritable', async () => {
  sessionStorage.setItem(repaymentStorageKey, 'broken');
  await render();
  await act(async () => button('Record repayment').click());
  expect(network.mutate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Submission is blocked');
});
it('keeps recovered inactive counterparties available under server historical authorization', async () => {
  const a = frozen();
  network.recover.mockResolvedValue({ repaymentOperation: success(a) });
  await act(async () =>
    root.render(
      <RepaymentForm
        scope={scope}
        group="G"
        name="G"
        today="2026-10-04"
        sender="a"
        recipient="b"
        suggested="1001"
        members={members.map((m) => ({ ...m, canParticipate: false }))}
        onCommitted={committed}
        onDenied={denied}
      />,
    ),
  );
  await act(async () => button('Recover original repayment').click());
  expect(committed).toHaveBeenCalledOnce();
});

it('ignores a delayed committed response after the actor financial scope is disposed', async () => {
  const a = frozen();
  await render();
  await act(async () => button('Retry original repayment').click());
  const options = network.mutate.mock.calls[0][1];
  scope.dispose();
  await act(async () =>
    options.onCompleted({ recordRepayment: success(a) }, null),
  );
  expect(committed).not.toHaveBeenCalled();
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(a);
});
