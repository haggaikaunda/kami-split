// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import {
  ExpenseRow,
  RecommendedRepaymentRow,
  SignedBalanceMetric,
} from './financial/presentation';
import { WorkspaceTabs } from './workspace/patterns';

it('preserves exact financial text and explicit balance meaning without summary actions', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <>
          {(['positive', 'negative', 'zero'] as const).map((position) => (
            <SignedBalanceMetric
              key={position}
              position={position}
              value="9,999,999,999,999.99"
              currency="USD"
            />
          ))}
        </>,
      ),
    );
    for (const label of ["You're owed", 'You owe', 'Settled'])
      expect(container.textContent).toContain(label);
    expect(container.querySelectorAll('[data-ui~="money"]')).toHaveLength(3);
    expect(container.textContent).toContain('9,999,999,999,999.99 USD');
    expect(container.querySelector('button, a')).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});

it('exposes consistent workspace route links and specific expense/repayment context', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <>
          <WorkspaceTabs
            current="Balances"
            hrefFor={(section) => `/groups/trip/${section.toLowerCase()}`}
          />
          <ExpenseRow
            href="/groups/example/expenses/123"
            description="Groceries"
            metadata="Sep 20 · Alex paid"
            space="Household"
            value="10.01"
            currency="USD"
          />
          <RecommendedRepaymentRow
            group="Maui"
            sender="Sam"
            recipient="Alex"
            value="5.01"
            currency="USD"
          />
        </>,
      ),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('nav button')!.click(),
    );
    const links = Array.from(container.querySelectorAll('nav a'));
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Expenses',
      'Balances',
      'Activity',
      'Members',
    ]);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      container.querySelector('[aria-current="page"]')?.getAttribute('href'),
    ).toBe('/groups/trip/balances');
    const expense = container.querySelector(
      'a[href="/groups/example/expenses/123"]',
    );
    expect(expense?.textContent).toContain('Household');
    expect(expense?.textContent).toContain('10.01 USD');
    expect(container.textContent).toContain('Sam pays Alex');
    expect(container.textContent).toContain('Maui');
  } finally {
    act(() => root.unmount());
  }
});

it('does not describe a zero Household aggregate as settled', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <SignedBalanceMetric
          scope="household"
          position="zero"
          value="0.00"
          currency="USD"
          detail="2 spaces have open balances"
        />,
      ),
    );
    expect(container.textContent).toContain('Net zero across spaces');
    expect(container.textContent).toContain('2 spaces have open balances');
    expect(container.textContent).not.toContain('Settled');
    expect(container.querySelector('a, button')).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
