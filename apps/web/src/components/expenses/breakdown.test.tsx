// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  categoryGeometry,
  categoryPercentage,
  ExpenseBreakdown,
} from './breakdown';
it('uses exact ratios for large amounts, tiny slices and zero denominators', () => {
  expect(categoryGeometry(9007199254740993n, 18014398509481986n)).toBe(50);
  expect(categoryPercentage(9007199254740993n, 18014398509481986n)).toBe(
    '50.0%',
  );
  expect(categoryPercentage(1n, 9007199254740993n)).toBe('<0.1%');
  expect(categoryGeometry(0n, 0n)).toBe(0);
  expect(categoryPercentage(0n, 0n)).toBe('0.0%');
});
it('retains zero-share category counts and an accessible amount instead of dividing by zero', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ExpenseBreakdown
        categories={[
          {
            category: 'HOME',
            totalExpenseMinor: '500',
            viewerShareMinor: '0',
            expenseCount: '4',
          },
        ]}
        totalExpenseMinor="500"
        viewerShareMinor="0"
        expenseCount="4"
        basis="share"
        onBasis={vi.fn()}
        onViewExpenses={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain('Your share is zero');
  expect(host.querySelector('.breakdown-legend')?.textContent).toContain(
    '0.0% · 4 matching expenses',
  );
  expect(host.querySelector('.breakdown-sector')).toBeNull();
  await act(async () => root.unmount());
});
