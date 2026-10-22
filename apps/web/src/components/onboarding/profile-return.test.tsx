// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { ProfileReturn } from './profile-return';
const nav = vi.hoisted(() => ({ search: 'source=visit' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({}),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    scroll,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    scroll?: boolean;
    onNavigate?: unknown;
  }) => {
    void scroll;
    void onNavigate;
    return <a {...props}>{children}</a>;
  },
}));
type Request = {
  next(data: unknown): void;
  unsubscribe: ReturnType<typeof vi.fn>;
};
let root: Root, host: HTMLDivElement, scope: FinancialScope;
const requests: Request[] = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests.length = 0;
  nav.search = 'source=visit';
  host = document.createElement('div');
  document.body.append(host);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    visits: new Map([
      [
        'visit',
        {
          href: '/trips/T?tab=expenses&categories=FOOD&sort=OLDEST',
          group: 'T',
          focus: 'workspace-account',
          scroll: 300,
        },
      ],
    ]),
    restored: new Set(),
    environment: queryEnvironment((request) => requests.push(request)),
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const response = (groups: { id: string; name: string }[]) => ({
  viewer: { __typename: 'Viewer', groups },
});
it('uses only freshly authorized names and preserves the exact return query', async () => {
  await act(async () => root.render(<ProfileReturn scope={scope} />));
  expect(host.textContent).toContain('Checking return destination…');
  expect(host.querySelector('a')).toBeNull();
  await act(async () =>
    requests[0].next(response([{ id: 'T', name: 'Actual trip <name>' }])),
  );
  expect(host.textContent).toBe('Back to Actual trip <name>');
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    '/trips/T?tab=expenses&categories=FOOD&sort=OLDEST&restore=visit',
  );
  expect(host.querySelector('name')).toBeNull();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).toContain('Checking return destination…');
  expect(host.querySelector('a')).toBeNull();
  expect(requests[0].unsubscribe).toHaveBeenCalled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => requests.at(-1)!.next(response([])));
  expect(host.textContent).toContain('Go to Groups');
  expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
});
it('does not carry a private source name or visit across account replacement', async () => {
  await act(async () => root.render(<ProfileReturn scope={scope} />));
  await act(async () =>
    requests[0].next(response([{ id: 'T', name: 'Alice private trip' }])),
  );
  scope = {
    ...scope,
    id: 'bob',
    actor: 'bob',
    visits: new Map(),
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => root.render(<ProfileReturn key="bob" scope={scope} />));
  expect(host.textContent).toContain('Go to Groups');
  expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
  expect(requests).toHaveLength(1);
});
it('uses truthful directory and Household labels without URL-provided names; missing tokens fall back', async () => {
  for (const [href, label] of [
    ['/groups?kind=trips&name=Untrusted', 'Groups'],
    ['/household?tab=balances', 'Household'],
    ['/household/expenses?view=breakdown', 'Household'],
  ]) {
    scope.visits.set('visit', { href, focus: 'workspace-account', scroll: 3 });
    await act(async () =>
      root.render(<ProfileReturn key={href} scope={scope} />),
    );
    expect(host.textContent).toBe(`Back to ${label}`);
    expect(host.querySelector('a')!.getAttribute('href')).toContain(
      'restore=visit',
    );
  }
  nav.search = 'source=expired&name=Alice';
  await act(async () =>
    root.render(<ProfileReturn key="expired" scope={scope} />),
  );
  expect(host.textContent).toContain('Go to Groups');
  expect(requests).toHaveLength(0);
});

it.each([
  '/trips/T/expenses/e?source=earlier',
  '/groups/T/repayments/new?sender=M&recipient=N',
  '/groups/T/activity?kind=expense',
])(
  'reauthorizes nested origin %s and preserves its exact return path',
  async (href) => {
    scope.visits.set('visit', {
      href,
      focus: 'workspace-account',
      scroll: 300,
    });
    await act(async () => root.render(<ProfileReturn scope={scope} />));
    expect(host.querySelector('a')).toBeNull();
    expect(requests).toHaveLength(1);
    await act(async () =>
      requests[0].next(response([{ id: 'T', name: 'Authorized trip' }])),
    );
    expect(host.textContent).toBe('Back to Authorized trip');
    const destination = new URL(href, 'https://workspace.invalid');
    destination.searchParams.set('restore', 'visit');
    expect(host.querySelector('a')!.getAttribute('href')).toBe(
      destination.pathname + destination.search,
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await act(async () => requests.at(-1)!.next(response([])));
    expect(host.textContent).toBe('Go to Groups');
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
  },
);
it.each([
  ['/groups/activity?kind=expense', 'Back to Activity', 'activity'],
  ['/groups/new?kind=trip', 'Back to Create group', 'new'],
  ['/trips/new', 'Back to Create trip', 'new'],
])(
  'returns static origin %s without interpreting its route name as a group ID',
  async (href, label, legacyGroup) => {
    // Even metadata produced by the former parser cannot turn a static route into a private group.
    scope.visits.set('visit', {
      href,
      group: legacyGroup,
      focus: 'workspace-account',
      scroll: 3,
    });
    await act(async () => root.render(<ProfileReturn scope={scope} />));
    expect(host.textContent).toBe(label);
    expect(requests).toHaveLength(0);
    expect(host.querySelector('a')!.getAttribute('href')).toContain(
      'restore=visit',
    );
  },
);

it('reauthorizes filtered Personal origins before preserving the exact return URL', async () => {
  const href =
    '/personal?tab=transactions&period=custom&from=2026-10-01&to=2026-10-22&kind=income';
  scope.visits.set('visit', { href, focus: 'workspace-account', scroll: 420 });
  await act(async () => root.render(<ProfileReturn scope={scope} />));
  expect(host.querySelector('a')).toBeNull();
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].next(response([])));
  expect(host.textContent).toBe('Back to Personal');
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    `${href}&restore=visit`,
  );
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('a')).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () =>
    requests
      .at(-1)!
      .next({ viewer: { __typename: 'Problem', code: 'UNAUTHENTICATED' } }),
  );
  expect(host.textContent).toBe('Go to Groups');
  expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
});

it('cannot restore an old actor Personal visit after scope disposal or replacement', async () => {
  scope.visits.set('visit', {
    href: '/personal?tab=connections',
    focus: 'workspace-account',
    scroll: 42,
  });
  scope = { ...scope, isLive: () => false };
  await act(async () => root.render(<ProfileReturn scope={scope} />));
  expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
  expect(requests).toHaveLength(0);
});
