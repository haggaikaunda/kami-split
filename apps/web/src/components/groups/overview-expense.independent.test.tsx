// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OverviewExpense, OverviewExpenseLink } from './overview-expense';
import type { FinancialScope } from '@/lib/relay/environment';
const state = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => state,
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: {
    children: ReactNode;
    onNavigate: (e: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...props}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(e);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/components/expenses/presentation', () => ({
  ExpensePresentation: ({
    onClose,
    children,
  }: {
    onClose: () => void;
    children: ReactNode;
  }) => (
    <section>
      <button onClick={onClose}>Close</button>
      {children}
    </section>
  ),
}));
vi.mock('./expense-detail', () => ({
  ExpenseDetail: ({ group, id }: { group: string; id: string }) => (
    <p>
      Authorized detail {group}:{id}
    </p>
  ),
}));
let host: HTMLDivElement, root: Root, scope: FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/household?tab=overview');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  scope = { visits: new Map() } as unknown as FinancialScope;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const renderDetail = () =>
  act(async () =>
    root.render(
      <OverviewExpense
        scope={scope}
        allowed={['home']}
        onCommitted={async () => {}}
        onUnavailable={vi.fn()}
      />,
    ),
  );
it('returns an in-session overview selection through Back so Forward can reopen it', async () => {
  await act(async () =>
    root.render(
      <OverviewExpenseLink
        scope={scope}
        id="expense"
        group="home"
        href="/household/expenses?expense=expense&expenseGroup=home"
      >
        Open expense
      </OverviewExpenseLink>,
    ),
  );
  await act(async () => host.querySelector('a')!.click());
  expect(state.push).toHaveBeenCalledOnce();
  window.history.pushState({}, '', state.push.mock.calls[0][0]);
  await renderDetail();
  expect(host.textContent).toContain('Authorized detail home:expense');
  await act(async () => host.querySelector('button')!.click());
  expect(state.back).toHaveBeenCalledOnce();
  expect(state.replace).not.toHaveBeenCalled();
});
it('uses a safe overview fallback for direct entry and never broadens unknown source access', async () => {
  window.history.replaceState(
    {},
    '',
    '/household?tab=overview&expense=expense&expenseGroup=secret&detailSource=stale',
  );
  await renderDetail();
  expect(host.textContent).toContain('Expense source is unavailable');
  expect(host.textContent).not.toContain('Authorized detail');
  await act(async () => host.querySelector('button')!.click());
  expect(state.back).not.toHaveBeenCalled();
  expect(state.replace).toHaveBeenCalledWith('/household?tab=overview', {
    scroll: false,
  });
});
