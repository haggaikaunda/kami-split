// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialScope } from '@/lib/relay/environment';
import { ScopedLink } from './navigation';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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
])(
  'captures Profile source %s with the correct authorization metadata',
  async (href, group) => {
    window.history.replaceState(null, '', href);
    const visits = new Map();
    const scope = { visits } as FinancialScope;
    await act(async () =>
      root.render(
        <ScopedLink scope={scope} id="header-profile" href="/account">
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
      focus: 'header-profile',
      scroll: 0,
    });
    expect(window.history.state.financialRestore).toBe(token);
  },
);
