// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { PersonalWorkspace } from './personal';
const session = vi.hoisted(() => ({
  scope: undefined as FinancialScope | undefined,
  loading: false,
  error: undefined as string | undefined,
}));
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('../groups/session', () => ({ useFinancialSession: () => session }));
vi.mock('./reporting-timezone-control', () => ({
  ReportingTimezoneInitialization: ({
    showPeriod,
  }: {
    showPeriod: boolean;
  }) => <p data-timezone-period={showPeriod ? 'current' : 'omitted'} />,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/personal',
  useRouter: () => ({}),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
const requests: Request[] = [];
let root: Root, host: HTMLDivElement;
const status = {
  operation: 'IDLE',
  importState: 'USABLE',
  usable: true,
  recovery: 'NONE',
  collection: 'COLLECTING',
  reportingState: 'CURRENT',
  freshness: 'OBSERVED',
  coverage: 'UNKNOWN',
  historyAvailability: 'unknown',
  historicalUpdate: 'COMPLETE',
  lastLocalCommit: '2026-10-20T11:00:00Z',
  providerSuccessAt: null,
  discrepancyCount: '0',
};
const connection = {
  id: 'c1',
  state: 'active',
  health: 'healthy',
  permission: 'granted',
  institutionName: 'Example Community Credit Union',
  cleanup: 'not_requested',
  purge: 'not_requested',
  accounts: [
    {
      id: 'a1',
      streamId: 's1',
      name: 'Sensitive long private checking account',
      kind: 'checking',
      currency: 'USD',
      selected: true,
      requestedHistoryDays: 365,
      importStatus: status,
    },
  ],
};
const inventory = (connections: unknown[] = [], code = 'READY') => ({
  bankingConnections: {
    __typename: 'BankingConnectionsResult',
    code,
    connections,
    endCursor: null,
    hasNextPage: false,
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  requests.length = 0;
  nav.search = '';
  session.loading = false;
  session.error = undefined;
  host = document.createElement('div');
  document.body.append(host);
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.scrollTo = vi.fn();
  session.scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
    invalidate: vi.fn(),
    environment: queryEnvironment((request) => requests.push(request)),
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => session.scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('defaults to This month Overview and routes first use to Connections without a connect control or fake total', async () => {
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Sensitive');
  expect(host.querySelector('button')).toBeNull();
  await act(async () => requests[0].next(inventory()));
  expect(host.textContent).toContain('This month');
  expect(
    host
      .querySelector('[data-timezone-period]')
      ?.getAttribute('data-timezone-period'),
  ).toBe('current');
  expect(host.textContent).toContain('Spending from your accounts');
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/personal?tab=connections',
  );
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('$0');
});
it('preserves applied Personal URL state while routing Transactions to setup', async () => {
  nav.search = 'tab=transactions&period=last-month&account=private-id';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory()));
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/personal?tab=connections&period=last-month&account=private-id',
  );
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('This month');
  expect(
    host
      .querySelector('[data-timezone-period]')
      ?.getAttribute('data-timezone-period'),
  ).toBe('omitted');
});
it('shows a known empty Connections state only after fresh owner authorization', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Connect account');
  await act(async () => requests[0].next(inventory()));
  expect(host.textContent).toContain('No connected accounts yet');
  expect(host.textContent).toContain('Connect account');
});
it('does not turn domain access failure into first-use enrollment or successful empty history', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([], 'FORBIDDEN')));
  expect(host.textContent).toContain('unavailable');
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('No connected accounts');
});
it('keeps import, freshness and history coverage distinct and avoids invented institution metadata', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.textContent).toContain('Sensitive long');
  expect(host.textContent).toContain('Included');
  expect(host.textContent).toContain('coverage is unknown');
  expect(host.textContent).toContain('Bank success observationUnknown');
  expect(host.textContent).not.toContain('All up to date');
  expect(host.textContent).not.toContain('ending ');
});
it('clears prior account details on foreground invalidation before the replacement read', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).not.toContain('Sensitive long');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].next(inventory([], 'UNAVAILABLE')));
  expect(host.textContent).not.toContain('Sensitive long');
  expect(host.textContent).not.toContain('No connected accounts');
});
it('isolates a late inventory response after actor switch and hides details while checking authentication', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  session.scope = {
    ...session.scope!,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.textContent).not.toContain('Sensitive long');
  await act(async () => requests[1].next(inventory([connection])));
  session.loading = true;
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Sensitive long');
});

it('leads existing Connections with the compact heading and leaves setup details undisclosed', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.querySelector('#connection-setup')).toBeNull();
  const title = host.querySelector('#connections-heading')!;
  const account = host.querySelector('article')!;
  expect(
    title.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host.querySelector('article')?.textContent).toContain(
    'Sensitive long',
  );
  expect(
    host.querySelector('#existing-connections > p')?.textContent,
  ).toContain('Selection controls updates');
  expect(
    host.querySelector('#existing-connections > p')?.textContent,
  ).toContain('History is retained');
});

it.each(['overview', 'transactions'])(
  'shows the owner-only privacy notice on first-use %s',
  async (section) => {
    nav.search = `tab=${section}`;
    await act(async () => root.render(<PersonalWorkspace />));
    await act(async () => requests[0].next(inventory()));
    expect(host.textContent).toContain(
      'Only you can see these bank accounts and their activity.',
    );
    expect(host.textContent).not.toContain('Connect account');
  },
);

it('keeps import facts collapsed while exposing selection and truthful distinct observations', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () =>
    requests[0].next(
      inventory([
        {
          ...connection,
          accounts: [
            {
              ...connection.accounts[0],
              id: 'a2',
              streamId: 's2',
              name: 'Unselected savings',
              selected: false,
            },
            connection.accounts[0],
          ],
        },
      ]),
    ),
  );
  const card = host.querySelector('article')!;
  const disclosure = card.querySelector('details')!;
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector('summary')?.textContent).toContain(
    'Latest local save:',
  );
  expect(disclosure.querySelector('summary')?.textContent).toContain(
    'Latest bank success: Unknown',
  );
  expect(card.querySelector('section h4')?.textContent).toContain(
    'Sensitive long',
  );
  expect(card.textContent).toContain('1 of 2 accounts included');
  expect(card.textContent).toContain('Not collecting');
  await act(async () => disclosure.querySelector('summary')!.click());
  expect(disclosure.open).toBe(true);
  expect(disclosure.textContent).toContain('coverage is unknown');
  expect(disclosure.textContent).toContain(
    '365 days, subject to institution availability',
  );
});
