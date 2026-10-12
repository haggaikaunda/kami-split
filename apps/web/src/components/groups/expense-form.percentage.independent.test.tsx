// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseForm } from './expense-form';
import { createScope } from '@/lib/relay/environment';
import {
  createInput,
  newDraft,
  readDraft,
  saveDraft,
  type Draft,
} from '@/lib/relay/draft';
import type { SupabaseClient } from '@supabase/supabase-js';

const network = vi.hoisted(() => ({ mutate: vi.fn(), recover: vi.fn() }));
vi.mock('relay-runtime', async (original) => ({
  ...(await original<object>()),
  commitMutation: (...args: unknown[]) => network.mutate(...args),
  fetchQuery: () => ({ toPromise: network.recover }),
}));
const group = 'ks1:Group:00000000-0000-4000-8000-000000000199';
const members = ['Kaunda', 'Mizenin', 'Sam'].map((displayName, index) => ({
  id: `ks1:Membership:00000000-0000-4000-8000-00000000000${index + 1}`,
  displayName,
  canParticipate: true,
}));
const valid = (): Draft => ({
  ...newDraft('2026-10-05', members[0].id, members),
  description: 'Weekend groceries',
  amount: '125.00',
  participants: members.slice(0, 2).map((member) => member.id),
});
let scope: ReturnType<typeof createScope>, root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    fn();
    return 1;
  });
  scope = createScope({} as SupabaseClient, 'actor');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  scope.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(draft: Draft, attempt?: ReturnType<typeof createInput>) {
  saveDraft({ version: 2, actor: scope.actor, group, draft, attempt });
  await act(async () =>
    root.render(
      <ExpenseForm
        scope={scope}
        group={group}
        payer={members[0].id}
        members={members}
        onCommitted={async () => {}}
      />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  )!;
}
function input(id: string) {
  return host.querySelector(`[id="${id}"]`) as HTMLInputElement;
}
function percentage(index: number) {
  return input(`percentage-${members[index].id}`);
}
async function set(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
async function select(mode: string) {
  await set(input('expense-split'), mode);
}

it('renders linked edits, preserves invalid intermediate text, and keeps each mode losslessly', async () => {
  await mount({
    ...valid(),
    exact: { [members[0].id]: '100', [members[1].id]: '25' },
  });
  await select('PERCENTAGE');
  expect(percentage(0).value).toBe('50');
  expect(host.textContent).toContain('Link percentages (two people)');
  await set(percentage(0), '62.50');
  expect(percentage(1).value).toBe('37.5');
  expect(host.textContent).toContain('$78.13');
  expect(host.textContent).toContain('$46.87');
  await set(percentage(0), '');
  expect(percentage(1).value).toBe('37.5');
  expect(percentage(0).getAttribute('aria-invalid')).toBe('true');
  expect(
    document.getElementById(percentage(0).getAttribute('aria-describedby')!)
      ?.textContent,
  ).toContain('Enter');
  expect(button('Save expense').disabled).toBe(true);
  await select('EXACT');
  expect(readDraft('actor', group)?.draft.exact).toEqual({
    [members[0].id]: '100',
    [members[1].id]: '25',
  });
  await select('PERCENTAGE');
  expect(percentage(0).value).toBe('');
  expect(percentage(1).value).toBe('37.5');
});

it('renders P3 incomplete and remaining assignment, with surviving/reselected inputs and amount recalculation', async () => {
  await mount({
    ...valid(),
    amount: '200',
    participants: members.map((m) => m.id),
    split: 'PERCENTAGE',
    percentageInitialized: true,
    linkedPercentages: false,
    percentages: {
      [members[0].id]: '40',
      [members[1].id]: '30',
      [members[2].id]: '15',
    },
  });
  expect(host.textContent).toContain('85% allocated · 15% remaining');
  expect(host.querySelector('.percentage-money')).toBeNull();
  expect(button('Save expense').disabled).toBe(true);
  await act(async () => button('Assign remaining to Sam').click());
  expect(percentage(2).value).toBe('30');
  expect(
    [...host.querySelectorAll('.percentage-money')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['$80.00', '$60.00', '$60.00']);
  const samSelection = [
    ...host.querySelectorAll('input[type="checkbox"]'),
  ][2] as HTMLInputElement;
  await act(async () => samSelection.click());
  expect(host.textContent).toContain('70% allocated · 30% remaining');
  expect(readDraft('actor', group)?.draft.linkedPercentages).toBe(false);
  await act(async () => samSelection.click());
  expect(percentage(2).value).toBe('30');
  await set(input('expense-amount'), '100');
  expect(
    [...host.querySelectorAll('.percentage-money')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['$40.00', '$30.00', '$30.00']);
});

it('restores and retries the frozen Percentage input without rebalancing or replacing its key', async () => {
  const draft = {
    ...valid(),
    split: 'PERCENTAGE' as const,
    linkedPercentages: true,
    percentageInitialized: true,
    percentages: { [members[0].id]: '60.00', [members[1].id]: '40.0' },
  };
  const attempt = createInput(draft, members, group, crypto.randomUUID());
  network.recover.mockResolvedValue({
    expenseOperation: {
      __typename: 'OperationProgress',
      key: attempt.key,
      state: 'NOT_OBSERVED',
    },
  });
  network.mutate.mockImplementation((_environment, options) =>
    options.onError(new Error('lost response')),
  );
  await mount(draft, attempt);
  expect(percentage(0).value).toBe('60.00');
  expect(percentage(1).value).toBe('40.0');
  await act(async () => button('Recover original result').click());
  await act(async () => button('Retry original expense').click());
  expect(network.mutate.mock.calls[0][1].variables.input).toEqual(attempt);
  expect(readDraft('actor', group)?.attempt).toEqual(attempt);
});
