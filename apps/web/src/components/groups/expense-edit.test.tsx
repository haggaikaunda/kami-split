// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ExpenseEdit } from './expense-edit';
import {
  expenseDraft,
  readEditDraft,
  saveEditDraft,
  type EditableExpense,
} from '@/lib/relay/edit-draft';
import { createInput } from '@/lib/relay/draft';
import type { FinancialScope } from '@/lib/relay/environment';
const network = vi.hoisted(() => ({ mutate: vi.fn(), read: vi.fn() }));
vi.mock('relay-runtime', async (original) => ({
  ...(await original<object>()),
  commitMutation: (...args: unknown[]) => network.mutate(...args),
  fetchQuery: () => ({ toPromise: network.read }),
}));
const members = [{ id: 'a', displayName: 'Alice', canParticipate: true }];
const expense = {
  __typename: 'Expense',
  id: 'e',
  groupId: 'g',
  version: '1',
  canEdit: true,
  editLockReason: null,
  description: 'Lunch',
  totalMinor: '1000',
  currency: 'USD',
  effectiveDate: '2026-10-01',
  category: 'DINING',
  note: '',
  payer: { id: 'a', displayName: 'Alice' },
  creator: { id: 'a', displayName: 'Alice' },
  createdAt: '2026-10-01T12:00:00Z',
  split: 'EQUAL',
  allocations: [
    {
      participant: { id: 'a', displayName: 'Alice' },
      amountMinor: '1000',
      percentageHundredths: null,
    },
  ],
} as EditableExpense;
let root: Root, host: HTMLDivElement, live: boolean;
const committed = vi.fn(async () => {}),
  cancel = vi.fn(),
  denied = vi.fn();
const scope = {
  actor: 'actor',
  environment: {},
  isLive: () => live,
} as FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  vi.resetAllMocks();
  live = true;
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
    f();
    return 1;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <ExpenseEdit
        scope={scope}
        expense={expense}
        members={members}
        onCancel={cancel}
        onCommitted={committed}
        onDenied={denied}
      />,
    ),
  );
}
function button(text: string) {
  return [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
}
function stored(attempt = false) {
  const draft = { ...expenseDraft(expense), amount: '8.00' };
  const input = {
    ...createInput(draft, members, 'g', crypto.randomUUID()),
    expenseId: 'e',
    expectedVersion: '1',
  };
  saveEditDraft({
    version: 1,
    actor: 'actor',
    group: 'g',
    expense: 'e',
    baseVersion: '1',
    draft,
    ...(attempt ? { attempt: input } : {}),
  });
  return input;
}
it('disables unchanged save and cancel has no financial effect', async () => {
  await render();
  expect(button('Save changes').disabled).toBe(true);
  await act(async () => button('Cancel editing').click());
  expect(cancel).toHaveBeenCalled();
  expect(network.mutate).not.toHaveBeenCalled();
});
it('persists frozen original version/key/input before dispatch and suppresses double save', async () => {
  stored();
  network.mutate.mockImplementation((_scope, options) => {
    expect(readEditDraft('actor', 'g', 'e')?.attempt).toEqual(
      options.variables.input,
    );
  });
  await render();
  await act(async () => {
    button('Save changes').click();
    button('Save changes').click();
  });
  expect(network.mutate).toHaveBeenCalledTimes(1);
  expect(readEditDraft('actor', 'g', 'e')?.attempt?.expectedVersion).toBe('1');
});
it('retains uncertain edits through reload and retries the original key after absent recovery', async () => {
  const input = stored(true);
  network.read.mockResolvedValue({
    updateExpenseOperation: {
      __typename: 'OperationProgress',
      key: input.key,
      state: 'NOT_OBSERVED',
    },
  });
  await render();
  expect(button('Save changes').disabled).toBe(true);
  expect(
    host.querySelector<HTMLFieldSetElement>('form > fieldset')?.disabled,
  ).toBe(true);
  await act(async () => button('Recover original edit').click());
  expect(readEditDraft('actor', 'g', 'e')?.attempt).toEqual(input);
  await act(async () => button('Retry original edit').click());
  expect(network.mutate.mock.calls[0][1].variables.input).toEqual(input);
});
it('conflict retains draft and requires reload and explicit reapplication with a new version/key', async () => {
  stored();
  network.mutate.mockImplementation((_scope, options) =>
    options.onCompleted({
      updateExpense: {
        __typename: 'ExpenseEditConflict',
        key: options.variables.input.key,
        currentVersion: '2',
      },
    }),
  );
  await render();
  await act(async () => button('Save changes').click());
  expect(readEditDraft('actor', 'g', 'e')?.attempt).toBeUndefined();
  expect(host.textContent).toContain('Someone changed');
  network.read.mockResolvedValue({
    node: { ...expense, version: '2', description: 'Newer saved description' },
  });
  await act(async () => button('Reload latest expense').click());
  expect(host.textContent).toContain('Newer saved description');
  expect(
    (host.querySelector('#expense-amount') as HTMLInputElement).value,
  ).toBe('8.00');
  await act(async () => button('Reapply my draft to this version').click());
  await act(async () => button('Save changes').click());
  const first = network.mutate.mock.calls[0][1].variables.input,
    second = network.mutate.mock.calls[1][1].variables.input;
  expect(second.expectedVersion).toBe('2');
  expect(second.key).not.toBe(first.key);
  expect(second.totalMinor).toBe('800');
});
it('late committed callback cannot clear a different disposed session draft or navigate', async () => {
  stored();
  await render();
  await act(async () => button('Save changes').click());
  live = false;
  const options = network.mutate.mock.calls[0][1];
  await act(async () =>
    options.onCompleted({
      updateExpense: {
        __typename: 'ExpenseEditCommitted',
        key: options.variables.input.key,
        version: '2',
        changed: true,
        record: { expenseId: 'e', groupId: 'g', totalMinor: '800' },
      },
    }),
  );
  expect(committed).not.toHaveBeenCalled();
  expect(readEditDraft('actor', 'g', 'e')?.attempt).toBeDefined();
});

it('shows actionable inline errors for an invalid retained draft while Save is disabled', async () => {
  saveEditDraft({
    version: 1,
    actor: 'actor',
    group: 'g',
    expense: 'e',
    baseVersion: '1',
    draft: { ...expenseDraft(expense), amount: 'invalid' },
  });
  await render();
  expect(button('Save changes').disabled).toBe(true);
  expect(host.textContent).toContain(
    'Enter dollars with up to two decimal places.',
  );
  expect(
    host.querySelector('#expense-amount')?.getAttribute('aria-invalid'),
  ).toBe('true');
  expect(network.mutate).not.toHaveBeenCalled();
});
it('keeps confirmed success and refreshes when clearing local recovery storage fails', async () => {
  stored();
  await render();
  await act(async () => button('Save changes').click());
  const options = network.mutate.mock.calls[0][1];
  const storage = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('storage unavailable');
    });
  try {
    await act(async () =>
      options.onCompleted({
        updateExpense: {
          __typename: 'ExpenseEditCommitted',
          key: options.variables.input.key,
          version: '2',
          changed: true,
          record: { expenseId: 'e', groupId: 'g', totalMinor: '800' },
        },
      }),
    );
    expect(committed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(
      'Edit saved. Its local recovery record could not be cleared.',
    );
    expect(host.textContent).not.toContain('result is uncertain');
    expect(button('Save changes').disabled).toBe(true);
    expect(
      host.querySelector<HTMLFieldSetElement>('form > fieldset')?.disabled,
    ).toBe(true);
  } finally {
    storage.mockRestore();
  }
  expect(readEditDraft('actor', 'g', 'e')?.attempt?.key).toBe(
    options.variables.input.key,
  );
});

it('initially focuses its title and leaves editable controls for deliberate user focus', async () => {
  await render();
  const heading = host.querySelector('#edit-expense-title')!;
  expect(document.activeElement).toBe(heading);
  expect(heading.getAttribute('tabindex')).toBe('-1');
  const description = host.querySelector<HTMLInputElement>(
    '#expense-description',
  )!;
  description.focus();
  expect(document.activeElement).toBe(description);
});
