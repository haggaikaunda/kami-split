// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { Enrollment } from './enrollment';
import type { PlaidSDK } from './plaid-link';
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
let root: Root, host: HTMLDivElement, scope: FinancialScope;
let config: Parameters<PlaidSDK['create']>[0];
const requests: Request[] = [];
const connected = vi.fn(),
  destroy = vi.fn(),
  open = vi.fn();
function button(text: string) {
  const result = [...host.querySelectorAll('button')].find(
    (value) => value.textContent === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
const result = (code: string) => ({
  __typename: 'BankingEnrollmentResult',
  code,
  state: code === 'PREPARED' ? 'prepared' : 'cleanup_pending',
  attemptId: 'attempt',
  connectionId: null,
});
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  requests.length = 0;
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    environment: queryEnvironment((request) => requests.push(request)),
  } as FinancialScope;
  window.Plaid = {
    create: vi.fn((options) => {
      config = options;
      return { open, destroy };
    }),
  };
  root = relayRoot(createRoot(host), () => scope);
  await act(async () =>
    root.render(
      <Enrollment key={scope.id} scope={scope} onConnected={connected} />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.Plaid;
});
async function prepare() {
  await click('Connect account');
  const id = (requests[0].variables.input as { attemptId: string }).attemptId;
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBe(id);
  await act(async () =>
    requests[0].next({
      startBankingEnrollment: {
        ...result('PREPARED'),
        attemptId: id,
        linkToken: 'sensitive-link-token',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  );
  expect(open).toHaveBeenCalledOnce();
  return id;
}
const accounts = [
  {
    id: 'checking',
    name: 'Long private checking account',
    type: 'depository',
    subtype: 'checking',
  },
  { id: 'savings', name: 'Savings', type: 'depository', subtype: 'savings' },
  {
    id: 'unsupported',
    name: 'Investment account',
    type: 'investment',
    subtype: 'brokerage',
  },
];
it('requires explicit account choice, filters unsupported accounts and ignores duplicate callbacks', async () => {
  const id = await prepare();
  await act(async () => {
    config.onSuccess('sensitive-public-token', { accounts });
    config.onSuccess('duplicate-token', { accounts: [] });
  });
  expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input')].every(
      (input) => !input.checked,
    ),
  ).toBe(true);
  expect(button('Include selected accounts').disabled).toBe(true);
  expect(host.textContent).not.toContain('Investment account');
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  await click('Include selected accounts');
  expect(requests[1].variables).toEqual({
    input: {
      attemptId: id,
      publicToken: 'sensitive-public-token',
      accountIds: ['checking'],
    },
  });
  await act(async () =>
    requests[1].next({
      finishBankingEnrollment: {
        ...result('AWAITING_INITIAL_IMPORT'),
        attemptId: id,
        connectionId: 'connection',
      },
    }),
  );
  expect(connected).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('awaiting import');
  expect(sessionStorage.length).toBe(0);
});
it('recovers the same attempt after response loss without another exchange or token storage', async () => {
  const id = await prepare();
  await act(async () =>
    config.onSuccess('sensitive-public-token', { accounts }),
  );
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  await click('Include selected accounts');
  await act(async () => requests[1].error());
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).not.toContain('sensitive-public-token');
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBe(id);
  await click('Check connection status');
  expect(requests[2].name).toBe('enrollmentRecoveryQuery');
  expect(requests[2].variables).toEqual({ attemptId: id });
  await act(async () =>
    requests[2].next({ bankingEnrollment: result('EXCHANGE_UNKNOWN') }),
  );
  expect(
    requests.filter((value) => value.name === 'enrollmentFinishMutation'),
  ).toHaveLength(1);
  expect(
    [...host.querySelectorAll('button')].some(
      (value) => value.textContent === 'Connect account',
    ),
  ).toBe(false);
});
it('keeps cleanup pending after cancellation and ignores late success', async () => {
  await prepare();
  await click('Cancel connection');
  expect(destroy).toHaveBeenCalled();
  await act(async () => config.onSuccess('late-token', { accounts }));
  expect(host.querySelector('input')).toBeNull();
  await act(async () =>
    requests[1].next({ cancelBankingEnrollment: result('CLEANUP_PENDING') }),
  );
  expect(host.textContent).toContain('cleanup is still pending');
  expect(sessionStorage.length).toBe(1);
  await click('Check connection status');
  await act(async () =>
    requests[2].next({ bankingEnrollment: result('RETRY_ALLOWED') }),
  );
  expect(button('Connect account')).toBeTruthy();
  expect(sessionStorage.length).toBe(0);
});
it.each([
  'REPLACEMENT_REQUIRED',
  'DUPLICATE_ACCOUNT',
  'INVALID_SELECTION',
  'NEEDS_ATTENTION',
])('retains %s until server cleanup permits retry', async (code) => {
  await prepare();
  await act(async () => config.onSuccess('token', { accounts }));
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  await click('Include selected accounts');
  await act(async () =>
    requests[1].next({ finishBankingEnrollment: result(code) }),
  );
  expect(sessionStorage.length).toBe(1);
  expect(host.querySelector('input')).toBeNull();
  expect(
    [...host.querySelectorAll('button')].some(
      (value) => value.textContent === 'Connect account',
    ),
  ).toBe(false);
});
it('does not open expired or invalid expiry handoffs and clearly reports disabled enrollment', async () => {
  await click('Connect account');
  await act(async () =>
    requests[0].next({
      startBankingEnrollment: {
        ...result('PREPARED'),
        linkToken: 'token',
        expiresAt: 'invalid',
      },
    }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(host.textContent).toContain('unavailable or expired');
});
it('shows known disabled state without trapping a nonexistent attempt', async () => {
  await click('Connect account');
  await act(async () =>
    requests[0].next({
      startBankingEnrollment: {
        ...result('FEATURE_DISABLED'),
        attemptId: null,
        state: null,
        linkToken: null,
        expiresAt: null,
      },
    }),
  );
  expect(host.textContent).toContain('not enabled');
  expect(sessionStorage.length).toBe(0);
  expect(button('Connect account')).toBeTruthy();
});
it('isolates actor replacement and late provider callbacks', async () => {
  await prepare();
  const oldConfig = config;
  scope = {
    ...scope,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () =>
    root.render(
      <Enrollment key={scope.id} scope={scope} onConnected={connected} />,
    ),
  );
  await act(async () => oldConfig.onSuccess('old-token', { accounts }));
  expect(host.textContent).not.toContain('Long private');
  expect(host.querySelector('input')).toBeNull();
  expect(connected).not.toHaveBeenCalled();
});

it('replays original setup with the same attempt after uncertain start and an absent status', async () => {
  await click('Connect account');
  const original = requests[0].variables;
  await act(async () => requests[0].error());
  await click('Check connection status');
  await act(async () =>
    requests[1].next({
      bankingEnrollment: {
        ...result('NOT_FOUND'),
        attemptId: null,
        state: null,
      },
    }),
  );
  await click('Continue secure connection');
  expect(requests[2].name).toBe('enrollmentStartMutation');
  expect(requests[2].variables).toEqual(original);
  expect(
    requests.filter((request) => request.name === 'enrollmentFinishMutation'),
  ).toHaveLength(0);
});
