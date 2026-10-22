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
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    environment: queryEnvironment((request) => requests.push(request)),
  } as FinancialScope;
  open.mockImplementation(() => {
    expect(host.querySelector('dialog[open]')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    const portal = document.createElement('div');
    portal.dataset.providerPortal = '';
    portal.innerHTML = '<button>Provider interaction</button>';
    document.body.append(portal);
  });
  window.Plaid = {
    create: vi.fn((options) => {
      config = {
        ...options,
        onSuccess: (...args) => {
          document.querySelector('[data-provider-portal]')?.remove();
          options.onSuccess(...args);
        },
        onExit: (error) => {
          document.querySelector('[data-provider-portal]')?.remove();
          options.onExit(error);
        },
      };
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
  document.querySelector('[data-provider-portal]')?.remove();
  vi.restoreAllMocks();
});
async function prepare() {
  await click('Connect account');
  await click('Continue with Plaid');
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
  await act(async () => config.onExit(null));
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
  expect(host.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Connect account'));
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
  await click('Continue with Plaid');
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
  await click('Continue with Plaid');
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
  await click('Continue with Plaid');
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

it('keeps setup collapsed until requested and permits cancel without a provider effect', async () => {
  expect(host.querySelector('#connection-setup')).toBeNull();
  expect(host.textContent).not.toContain('365 days');
  expect(host.textContent).not.toContain('Replace existing account');
  await click('Connect account');
  expect(requests).toHaveLength(0);
  expect(button('Connect account').getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('365 days');
  expect(host.textContent).toContain('Replace existing account');
  await click('Cancel setup');
  expect(document.activeElement).toBe(button('Connect account'));
  expect(host.querySelector('#connection-setup')).toBeNull();
  expect(requests).toHaveLength(0);
});

it('reveals recovery for a saved unfinished attempt without reopening setup', async () => {
  await click('Connect account');
  await click('Continue with Plaid');
  const attemptId = (requests[0].variables.input as { attemptId: string })
    .attemptId;
  await act(async () => requests[0].error());
  await act(async () =>
    root.render(
      <Enrollment key="revisit" scope={scope} onConnected={connected} />,
    ),
  );
  expect(requests[1].name).toBe('enrollmentRecoveryQuery');
  expect(requests[1].variables).toEqual({ attemptId });
  expect(host.querySelector('#connection-setup')).not.toBeNull();
  expect(
    [...host.querySelectorAll('button')].some(
      (button) => button.textContent === 'Connect account',
    ),
  ).toBe(false);
  await act(async () =>
    requests[1].next({ bankingEnrollment: result('EXCHANGE_UNKNOWN') }),
  );
  expect(button('Check connection status')).toBeTruthy();
});

it('uses a named native modal with keyboard containment and request-free close/escape', async () => {
  await click('Connect account');
  const dialog = host.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  expect(
    document.getElementById(dialog.getAttribute('aria-labelledby')!)
      ?.textContent,
  ).toBe('Connect your accounts');
  expect(document.activeElement?.tagName).toBe('H2');
  expect(document.body.style.overflow).toBe('hidden');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
  await act(async () => {
    controls.at(-1)!.focus();
    controls.at(-1)!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(controls[0]);
  await act(async () =>
    controls[0].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement).toBe(controls.at(-1));
  await act(async () =>
    dialog.dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true }),
    ),
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Connect account'));
  expect(document.body.style.overflow).not.toBe('hidden');
  expect(requests).toHaveLength(0);
});
it('hands native-modal focus to the provider body portal, then reopens explicit selection safely', async () => {
  await prepare();
  const portal = document.querySelector<HTMLElement>('[data-provider-portal]')!;
  expect(portal.parentElement).toBe(document.body);
  expect(host.contains(portal)).toBe(false);
  expect(host.querySelector('dialog')).toBeNull();
  expect(button('Resume connection').disabled).toBe(true);
  await act(async () => config.onSuccess('token', { accounts }));
  expect(host.querySelector('dialog')?.open).toBe(true);
  const checkbox = host.querySelector<HTMLInputElement>('input')!;
  await act(async () => checkbox.click());
  const originalCount = requests.length;
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Close Connect your accounts"]',
      )!
      .click(),
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(sessionStorage.length).toBe(1);
  expect(document.activeElement).toBe(button('Resume connection'));
  await click('Resume connection');
  expect(requests).toHaveLength(originalCount);
  expect(host.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  await click('Include selected accounts');
  expect(requests.at(-1)!.name).toBe('enrollmentFinishMutation');
});
it('closing while preparation is pending never silently launches Plaid or cancels the attempt', async () => {
  await click('Connect account');
  await click('Continue with Plaid');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Close Connect your accounts"]',
      )!
      .click(),
  );
  await act(async () =>
    requests[0].next({
      startBankingEnrollment: {
        ...result('PREPARED'),
        linkToken: 'token',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(host.querySelector('dialog')).toBeNull();
  expect(sessionStorage.length).toBe(1);
  await click('Resume connection');
  expect(requests).toHaveLength(1);
  expect(button('Continue secure connection')).toBeTruthy();
});

it('provider exit reopens recovery while late success after actual cancellation stays ignored', async () => {
  await prepare();
  await act(async () => config.onExit({ error_code: 'INVALID_LINK_TOKEN' }));
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.textContent).toContain('session expired');
  await click('Cancel connection');
  await act(async () => config.onSuccess('late-token', { accounts }));
  expect(host.querySelector('input')).toBeNull();
  expect(
    requests.filter((request) => request.name === 'enrollmentFinishMutation'),
  ).toHaveLength(0);
});

it('retains the original attempt after cancellation finds no reservation yet', async () => {
  await click('Connect account');
  await click('Continue with Plaid');
  const original = requests[0].variables;
  const attemptId = (original.input as { attemptId: string }).attemptId;
  await act(async () => requests[0].error());
  await click('Cancel connection');
  await act(async () =>
    requests[1].next({
      cancelBankingEnrollment: {
        ...result('NOT_FOUND'),
        attemptId: null,
        state: null,
      },
    }),
  );
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBe(
    attemptId,
  );
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(
    [...host.querySelectorAll('button')].some(
      (button) => button.textContent === 'Connect account',
    ),
  ).toBe(false);
  await click('Continue secure connection');
  expect(requests[2].name).toBe('enrollmentStartMutation');
  expect(requests[2].variables).toEqual(original);
  expect(
    requests.filter((request) => request.name === 'enrollmentFinishMutation'),
  ).toHaveLength(0);
});
