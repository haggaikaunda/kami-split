// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ExpenseDetail } from './expense-detail';
import type { FinancialScope } from '@/lib/relay/environment';
const boundary = vi.hoisted(() => ({
  observers: [] as { next: (value: unknown) => void; error: () => void }[],
}));
vi.mock('./expense-edit', () => ({
  ExpenseEdit: ({ onCommitted }: { onCommitted: () => Promise<void> }) => (
    <button onClick={() => void onCommitted()}>Commit fixture edit</button>
  ),
}));
it('keeps the successful edit receipt visible after its fresh detail read fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  boundary.observers = [];
  const host = document.createElement('div');
  document.body.append(host);
  const scope = {
    actor: 'actor',
    environment: queryEnvironment((request) =>
      boundary.observers.push(request),
    ),
    isLive: () => true,
  } as FinancialScope;
  const root = relayRoot(createRoot(host), () => scope);
  try {
    await act(async () =>
      root.render(<ExpenseDetail scope={scope} group="g" id="e" />),
    );
    await act(async () =>
      boundary.observers[0].next({
        node: {
          __typename: 'Expense',
          id: 'e',
          groupId: 'g',
          canEdit: true,
          editLockReason: null,
          version: '1',
          description: 'Lunch',
          effectiveDate: '2026-10-01',
          totalMinor: '1000',
          currency: 'USD',
          category: 'DINING',
          payer: { id: 'a', displayName: 'Alice' },
          creator: { id: 'a', displayName: 'Alice' },
          note: '',
          createdAt: '2026-10-01T00:00:00Z',
          split: 'EQUAL',
          allocations: [],
        },
      }),
    );
    await act(async () => host.querySelector('button')!.click());
    await act(async () =>
      boundary.observers[1].next({
        group: { __typename: 'Group', id: 'g', members: [] },
      }),
    );
    await act(async () => host.querySelector('button')!.click());
    await act(async () => boundary.observers[2].error());
    expect(host.textContent).toContain('Expense edit saved');
    expect(host.textContent).toContain('Expense unavailable');
    expect(host.textContent).not.toContain('Lunch');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
