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
  expect(
    host.querySelector('[data-ui~="breakdown-legend"]')?.textContent,
  ).toContain('0.0% · 4 expenses');
  expect(host.querySelector('[data-ui~="breakdown-sector"]')).toBeNull();
  expect(host.textContent).toContain(
    'Counts include all matching expenses, including any with zero viewer share.',
  );
  expect(host.textContent).not.toContain('Percentages are rounded');
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
    ...host.querySelectorAll<HTMLButtonElement>(
      '[data-ui~="breakdown-legend"] button',
    ),
  ].find((button) => button.textContent?.includes('Home'))!;
  await act(async () => home.click());
  expect(home.getAttribute('aria-pressed')).toBe('true');
  expect(
    host.querySelector('[data-ui~="breakdown-center"]')?.textContent,
  ).toContain('$90,071,992,547,409.93');
  expect(
    host.querySelector('[data-ui~="breakdown-center"]')?.textContent,
  ).toContain('3 expenses');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[data-ui~="breakdown-drilldown"] button',
      )!
      .click(),
  );
  expect(drill).toHaveBeenLastCalledWith('HOME');
  await act(async () => home.click());
  expect(home.getAttribute('aria-pressed')).toBe('false');
  expect(
    host.querySelector('[data-ui~="breakdown-center"]')?.textContent,
  ).toContain('$90,071,992,547,410.00');
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        '[data-ui~="breakdown-drilldown"] button',
      )!
      .click(),
  );
  expect(drill).toHaveBeenLastCalledWith(null);
  await act(async () => root.unmount());
});

it.each([
  { home: '500', dining: '500', total: '1000', rounded: false },
  { home: '1', dining: '2', total: '3', rounded: true },
])(
  'explains displayed percentage rounding only when needed: $total',
  async ({ home, dining, total, rounded }) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <ExpenseBreakdown
          categories={[
            {
              category: 'HOME',
              totalExpenseMinor: home,
              viewerShareMinor: '0',
              expenseCount: '1',
            },
            {
              category: 'DINING',
              totalExpenseMinor: dining,
              viewerShareMinor: '0',
              expenseCount: '1',
            },
          ]}
          totalExpenseMinor={total}
          viewerShareMinor="0"
          expenseCount="2"
          basis="total"
          onBasis={vi.fn()}
          onViewExpenses={vi.fn()}
        />,
      ),
    );
    expect(host.textContent?.includes('Percentages are rounded')).toBe(rounded);
    expect(host.textContent).not.toContain(
      'Counts include all matching expenses, including any with zero viewer share.',
    );
    await act(async () => root.unmount());
  },
);

it('explains share counts even when a positive aggregate can include zero-share expenses', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ExpenseBreakdown
        categories={[
          {
            category: 'HOME',
            totalExpenseMinor: '1000',
            viewerShareMinor: '500',
            expenseCount: '2',
          },
        ]}
        totalExpenseMinor="1000"
        viewerShareMinor="500"
        expenseCount="2"
        basis="share"
        onBasis={vi.fn()}
        onViewExpenses={vi.fn()}
      />,
    ),
  );
  expect(
    host.querySelector('[data-ui~="breakdown-legend"]')?.textContent,
  ).toContain('100.0% · 2 expenses');
  expect(host.textContent).toContain(
    'Counts include all matching expenses, including any with zero viewer share.',
  );
  expect(host.textContent).not.toContain('Percentages are rounded');
  await act(async () => root.unmount());
});
