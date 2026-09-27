// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseRecordView } from './expense-record';
import { fixture } from '../lib/data/fixtures';
import { createMockData } from '../lib/data/mock';
import type { Snapshot, ExpenseInput } from '../lib/data/port';

vi.mock('next/link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
function render(
  snapshot: Snapshot,
  id: string,
  selectedRevision?: string,
  actions = false,
) {
  act(() =>
    root.render(
      <ExpenseRecordView
        snapshot={snapshot}
        record={snapshot.expenses.find((row) => row.id === id)!}
        selectedRevision={selectedRevision}
        renderActions={
          actions ? () => <button>Edit connected</button> : undefined
        }
      />,
    ),
  );
}

describe('expense values and immutable audit detail', () => {
  it('shows exact three-member allocations, creator and trip association', () => {
    const snapshot = fixture('three-members', '2026-09-20');
    render(snapshot, '102');
    const current = container.querySelector('.expense-values')!;
    expect(current.textContent).toContain('River');
    expect(current.querySelectorAll('.expense-allocations li')).toHaveLength(3);
    expect(current.textContent).toContain('USD');
    expect(current.textContent).toContain('Created by');
    expect(current.querySelector('a')?.getAttribute('href')).toBe(
      '/trips/maui',
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('retains included zero-share members and a nonparticipating payer', async () => {
    const { port } = createMockData({ fixture: 'three-members' });
    const value: ExpenseInput = {
      amount: 1001,
      currency: 'USD',
      description: 'Zero share stays included',
      effectiveDate: '2026-09-20',
      payerId: 'member-r',
      participantIds: ['member-k', 'member-m'],
      allocations: [
        { memberId: 'member-k', amount: 1001 },
        { memberId: 'member-m', amount: 0 },
      ],
      split: 'exact',
      category: 'Other',
      tripId: null,
      note: 'Test note',
    };
    const result = await port.execute({
      householdId: 'household-demo',
      operationId: 'detail-zero',
      command: { kind: 'create-expense', value },
    });
    const read = await port.read('household-demo');
    if (result.status !== 'ok' || read.status !== 'ok')
      throw new Error('Expected valid adapter data');
    render(read.value, 'id' in result.value ? result.value.id : '');
    const current = container.querySelector('.expense-values')!;
    expect(current.querySelectorAll('.expense-allocations li')).toHaveLength(2);
    expect(current.textContent).toContain(
      'Mizenin Included participant$0.00 USD',
    );
    expect(current.textContent).toContain(
      'River paid but is not a participant',
    );
    expect(current.textContent).toContain('Test note');
  });

  it('identifies selected immutable revision separately from edited current values and actors', async () => {
    const { port, demo } = createMockData();
    const initial = await port.read('household-demo');
    if (initial.status !== 'ok') throw new Error('Expected seed');
    const old = initial.value.expenses.find((row) => row.id === '2')!;
    demo.actor('member-m');
    await port.execute({
      householdId: 'household-demo',
      operationId: 'edit-detail',
      command: {
        kind: 'update-expense',
        id: '2',
        expectedVersion: 1,
        value: {
          ...old,
          description: 'Changed dinner',
          note: 'Edited by Mizenin',
          effectiveDate: '2026-10-01',
        },
      },
    });
    const read = await port.read('household-demo');
    if (read.status !== 'ok') throw new Error('Expected read');
    render(read.value, '2', '1');
    expect(container.querySelector('h1')?.textContent).toBe('Changed dinner');
    const selected = container.querySelector('details[open]')!;
    expect(selected.textContent).toContain(old.description);
    expect(selected.textContent).toContain('September 18, 2026');
    expect(selected.textContent).not.toContain('Edited by Mizenin');
    expect(container.textContent).toContain('Current record is revision 2');
    expect(container.textContent).toContain('By Mizenin');
    expect(container.querySelector('.expense-values')?.textContent).toContain(
      'Created byKaunda',
    );
  });

  it('renders retained tombstone with reason and removes mutation intent hooks', async () => {
    const { port } = createMockData();
    await port.execute({
      householdId: 'household-demo',
      operationId: 'delete-detail',
      command: {
        kind: 'delete-expense',
        id: '2',
        expectedVersion: 1,
        reason: 'Duplicate entry',
      },
    });
    const read = await port.read('household-demo');
    if (read.status !== 'ok') throw new Error('Expected read');
    render(read.value, '2', '2', true);
    expect(container.textContent).toContain(
      'no longer contributes to balances or spending',
    );
    expect(container.querySelector('details[open]')?.textContent).toContain(
      'Duplicate entry',
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('details')).toHaveLength(2);
    render(read.value, '2', '999');
    expect(container.textContent).toContain(
      'requested revision is unavailable',
    );
    expect(container.querySelector('h1')?.textContent).toContain('Dinner');
  });
});
