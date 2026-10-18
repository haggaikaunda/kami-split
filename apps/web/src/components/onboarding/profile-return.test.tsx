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
          focus: 'header-profile',
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
  expect(host.textContent).toContain('Back to Groups');
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
  expect(host.textContent).toContain('Back to Groups');
  expect(host.querySelector('a')!.getAttribute('href')).toBe('/groups');
  expect(requests).toHaveLength(1);
});
it('uses truthful directory and Household labels without URL-provided names; missing tokens fall back', async () => {
  for (const [href, label] of [
    ['/groups?kind=trips&name=Untrusted', 'Groups'],
    ['/household?tab=balances', 'Household'],
    ['/household/expenses?view=breakdown', 'Household'],
  ]) {
    scope.visits.set('visit', { href, focus: 'header-profile', scroll: 3 });
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
  expect(host.textContent).toContain('Back to Groups');
  expect(requests).toHaveLength(0);
});
