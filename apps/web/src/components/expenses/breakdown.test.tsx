// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  categoryGeometry,
  categoryPercentage,
  categoryPath,
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
    '0.0% · 4 expenses',
  );
  expect(host.querySelector('.breakdown-sector')).toBeNull();
  await act(async () => root.unmount());
});

it('draws a complete annulus when one category accounts for the whole view', () => {
  const path = categoryPath(0, 100);
  expect(path).not.toMatch(/NaN|Infinity/);
  // Half-circle arcs must traverse both halves; a single start=end arc disappears.
  const arcs = [...path.matchAll(/A[\d.]+,[\d.]+ 0 0 [01] ([^ ]+)/g)].map(
    (match) => match[1].split(',').map(Number),
  );
  expect(arcs).toHaveLength(4);
  expect(arcs[0][1]).toBeGreaterThan(350);
  expect(arcs[1][1]).toBeLessThan(25);
  expect(arcs[2][1]).toBeGreaterThan(290);
  expect(arcs[3][1]).toBeLessThan(90);
});
it('selects and clears a legend category with exact totals and matching drilldown', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'),
    root = createRoot(host),
    drill = vi.fn();
  const categories = [
    {
      category: 'HOME',
      totalExpenseMinor: '9007199254740993',
      viewerShareMinor: '1',
      expenseCount: '3',
    },
    {
      category: 'DINING',
      totalExpenseMinor: '7',
      viewerShareMinor: '0',
      expenseCount: '1',
    },
  ];
  await act(async () =>
    root.render(
      <ExpenseBreakdown
        categories={categories}
        totalExpenseMinor="9007199254741000"
        viewerShareMinor="1"
        expenseCount="4"
        basis="total"
        onBasis={vi.fn()}
        onViewExpenses={drill}
      />,
    ),
  );
  const home = [
    ...host.querySelectorAll<HTMLButtonElement>('.breakdown-legend button'),
  ].find((button) => button.textContent?.includes('Home'))!;
  await act(async () => home.click());
  expect(home.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('.breakdown-center')?.textContent).toContain(
    '$90,071,992,547,409.93',
  );
  expect(host.querySelector('.breakdown-center')?.textContent).toContain(
    '3 expenses',
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('.breakdown-drilldown button')!
      .click(),
  );
  expect(drill).toHaveBeenLastCalledWith('HOME');
  await act(async () => home.click());
  expect(home.getAttribute('aria-pressed')).toBe('false');
  expect(host.querySelector('.breakdown-center')?.textContent).toContain(
    '$90,071,992,547,410.00',
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('.breakdown-drilldown button')!
      .click(),
  );
  expect(drill).toHaveBeenLastCalledWith(null);
  await act(async () => root.unmount());
});
