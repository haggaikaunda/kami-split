// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HouseholdBannerAction } from './household-banner-action';
import type { FinancialScope } from '@/lib/relay/environment';
const nav = vi.hoisted(() => ({ path: '/household', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({ default: 'a' }));
type Request = {
  next(result: unknown): void;
  error(): void;
  unsubscribe: ReturnType<typeof vi.fn>;
};
const requests: Request[] = [];
let root: Root, host: HTMLDivElement, scope: FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  scope = {
    environment: queryEnvironment((request) => requests.push(request)),
    isLive: () => true,
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => scope);
  requests.length = 0;
  nav.path = '/household';
  nav.search = '';
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const home = {
  viewer: {
    __typename: 'Viewer',
    id: 'viewer',
    groups: [
      { id: 'home/a', isHousehold: true },
      { id: 'trip', isHousehold: false },
    ],
  },
};
it('resolves an invalidated Household source across tab routes and preserves expense filters', async () => {
  for (const [path, search] of [
    ['/household', 'tab=overview'],
    ['/household', 'tab=balances'],
    ['/household', 'tab=members'],
    ['/household/activity', ''],
    ['/household/ledger', ''],
    [
      '/household/expenses',
      'category=FOOD&view=breakdown&sort=oldest&expense=e&expenseGroup=g&after=cursor',
    ],
  ]) {
    scope.environment.commitUpdate((store) => {
      (store as typeof store & { invalidateStore(): void }).invalidateStore();
    });
    nav.path = path;
    nav.search = search;
    await act(async () =>
      root.render(<HouseholdBannerAction key={path + search} scope={scope} />),
    );
    expect(host.querySelector('a')).toBeNull();
    await act(async () => requests.at(-1)!.next(home));
    const href = host.querySelector('a')!.getAttribute('href')!;
    const query = new URL(href, 'http://localhost').searchParams;
    expect(query.get('create')).toBe('home/a');
    expect(href).toMatch(/^\/household\/expenses\?/);
    if (path.endsWith('/expenses')) {
      expect(query.get('category')).toBe('FOOD');
      expect(query.get('view')).toBe('breakdown');
      expect(query.get('sort')).toBe('oldest');
      expect(query.has('expense')).toBe(false);
      expect(query.has('after')).toBe(false);
    }
  }
});
it('invalidates stale source synchronously on foreground and ignores late replies after access failure or actor disposal', async () => {
  await act(async () => root.render(<HouseholdBannerAction scope={scope} />));
  await act(async () => requests[0].next(home));
  expect(host.querySelector('a')).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('a')).toBeNull();
  expect(requests[0].unsubscribe).toHaveBeenCalled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () =>
    requests
      .at(-1)!
      .next({ viewer: { __typename: 'Problem', code: 'FORBIDDEN' } }),
  );
  await act(async () => requests[0].next(home));
  expect(host.querySelector('a')).toBeNull();
  await act(async () =>
    root.render(
      <HouseholdBannerAction
        key="new-actor"
        scope={{ ...scope, isLive: () => false }}
      />,
    ),
  );
  await act(async () => requests.at(-1)!.next(home));
  expect(host.querySelector('a')).toBeNull();
});

it('revalidates the banner source on accepted workspace pull refresh without keeping the old link', async () => {
  await act(async () => root.render(<HouseholdBannerAction scope={scope} />));
  await act(async () => requests[0].next(home));
  expect(host.querySelector('a')).not.toBeNull();
  await act(async () =>
    window.dispatchEvent(new Event('workspace-refresh-request')),
  );
  expect(host.querySelector('a')).toBeNull();
  expect(requests[0].unsubscribe).toHaveBeenCalled();
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].error());
  expect(host.querySelector('a')).toBeNull();
});
