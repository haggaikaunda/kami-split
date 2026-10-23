// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialScope } from '@/lib/relay/environment';
import { ScopedLink, RestoreSource } from './navigation';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate: (event: { preventDefault(): void }) => void;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(event);
      }}
    >
      {children}
    </a>
  ),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  push.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.history.replaceState(null, '', '/');
});
it.each([
  ['/groups/G?tab=balances', 'G'],
  ['/trips/T/expenses/e?source=earlier', 'T'],
  ['/groups/G/repayments/new?sender=M&recipient=N', 'G'],
  ['/groups/g%2Fa/activity?kind=expense', 'g/a'],
  ['/groups/activity?kind=expense', undefined],
  ['/groups/new?kind=trip', undefined],
  ['/trips/new', undefined],
  ['/groups?kind=trips', undefined],
  [
    '/personal?tab=transactions&period=custom&from=2026-10-01&to=2026-10-22&kind=income',
    undefined,
  ],
])(
  'captures Profile source %s with the correct authorization metadata',
  async (href, group) => {
    window.history.replaceState(null, '', href);
    const visits = new Map();
    const scope = { visits } as FinancialScope;
    await act(async () =>
      root.render(
        <ScopedLink scope={scope} id="workspace-account" href="/account">
          Profile
        </ScopedLink>,
      ),
    );
    await act(async () => host.querySelector('a')!.click());
    const destination = new URL(push.mock.calls[0][0], window.location.origin);
    const token = destination.searchParams.get('source');
    expect(token).toBeTruthy();
    expect(visits.get(token)).toEqual({
      href,
      group,
      focus: 'workspace-account',
      scroll: 0,
    });
    expect(window.history.state.financialRestore).toBe(token);
  },
);

it.each([true, false])(
  'reveals a native disclosure only for an authorized restored origin (allowed=%s)',
  async (allowed) => {
    window.history.replaceState(null, '', '/personal?restore=origin');
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(0), 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.scrollTo = vi.fn();
    const scope = {
      isLive: () => true,
      visits: new Map([
        [
          'origin',
          {
            href: '/personal?tab=transactions',
            focus: 'archive-origin',
            scroll: 200,
            ...(!allowed ? { group: 'foreign' } : {}),
          },
        ],
      ]),
      restored: new Set(),
    } as unknown as FinancialScope;
    await act(async () =>
      root.render(
        <>
          <RestoreSource scope={scope} allowed={[]} />
          <details>
            <summary>History</summary>
            <a id="archive-origin" href="/personal?archive=manifest">
              Archive
            </a>
          </details>
        </>,
      ),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(host.querySelector('details')!.open).toBe(allowed);
    expect(document.activeElement?.id === 'archive-origin').toBe(allowed);
  },
);
