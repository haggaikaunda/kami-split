// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../lib/data/fixtures';
import type { ExpenseRecord, Snapshot } from '../lib/data/port';
import { ExpenseRecordView } from './expense-record';
import { ExpenseLink } from './navigation/links';
import { Dialog, Button } from './primitives';

const navigation = vi.hoisted(() => ({
  openExpense: vi.fn(),
  openContext: vi.fn(),
}));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => navigation,
}));
vi.mock('next/link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function render(
  snapshot: Snapshot,
  record: ExpenseRecord,
  selectedRevision?: string,
) {
  act(() =>
    root.render(
      <ExpenseRecordView
        snapshot={snapshot}
        record={record}
        selectedRevision={selectedRevision}
      />,
    ),
  );
}
function facts(element: Element) {
  return Object.fromEntries(
    [...element.querySelectorAll('dl > div')].map((row) => [
      row.querySelector('dt')!.textContent,
      row.querySelector('dd')!.textContent,
    ]),
  );
}

describe('independent expense detail acceptance probes', () => {
  it('keeps native revision summary in modal keyboard order without intercepting Shift+Tab', () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    act(() =>
      root.render(
        <Dialog open title="Expense details" onClose={vi.fn()}>
          <details>
            <summary>Revision 1</summary>
            <p>Recorded values</p>
          </details>
          <Button>Back to previous view</Button>
        </Dialog>,
      ),
    );
    const summary = container.querySelector('summary')!;
    summary.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => summary.dispatchEvent(shiftTab));
    expect(shiftTab.defaultPrevented).toBe(false);
    const buttons = container.querySelectorAll('button');
    buttons[buttons.length - 1].focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    act(() => buttons[buttons.length - 1].dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
  it('shows a complete selected snapshot independent of changed current fields and unrelated histories', () => {
    const snapshot = fixture('three-members', '2026-09-20');
    const original = snapshot.expenses.find((row) => row.id === '102')!;
    const current: ExpenseRecord = {
      ...original,
      description: 'New current description',
      amount: 101,
      effectiveDate: '2027-01-02',
      payerId: 'member-r',
      participantIds: ['member-k', 'member-m'],
      allocations: [
        { memberId: 'member-k', amount: 101 },
        { memberId: 'member-m', amount: 0 },
      ],
      split: 'exact',
      category: 'Other',
      tripId: null,
      note: 'Current private note',
      version: 2,
      updatedAt: '2026-09-21T12:00:00.000Z',
    };
    snapshot.expenses = snapshot.expenses.map((row) =>
      row.id === current.id ? current : row,
    );
    snapshot.revisions.push({
      id: 'revision-new',
      expenseId: current.id,
      version: 2,
      actorId: 'member-m',
      at: current.updatedAt,
      reason: '',
      snapshot: structuredClone(current),
    });
    const before = structuredClone(snapshot);
    render(snapshot, current, '1');
    const active = container.querySelector('.expense-values')!;
    expect(facts(active)).toMatchObject({
      Description: 'New current description',
      'Expense date': 'January 2, 2027',
      'Paid by': 'River',
      Category: 'Other',
      Trip: 'Everyday expense',
      'Split method': 'Exact amounts',
      'Created by': 'Kaunda',
      Revision: '2',
      Note: 'Current private note',
    });
    const selected = container.querySelector('details[open]')!;
    expect(selected.querySelectorAll('.expense-allocations li')).toHaveLength(
      3,
    );
    expect(facts(selected)).toMatchObject({
      Description: original.description,
      'Expense date': 'September 6, 2026',
      'Paid by': 'Kaunda',
      Category: 'Dining',
      Trip: 'A week in Maui',
      'Split method': 'Equal',
      Revision: '1',
      Note: 'No note',
    });
    expect(selected.querySelector('.expense-total')!.textContent).toBe(
      '$86.20 USD',
    );
    expect(selected.textContent).not.toContain('Current private note');
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(snapshot).toEqual(before);
  });

  it('switches audit selection without altering current record identity', () => {
    const snapshot = fixture('sample', '2026-09-20');
    const record = snapshot.expenses[0];
    render(snapshot, record, '1');
    expect(container.querySelector('details[open]')).not.toBeNull();
    render(snapshot, record, '99');
    expect(container.querySelector('details[open]')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'requested revision is unavailable',
    );
    expect(container.querySelector('h1')!.textContent).toBe(record.description);
    render(snapshot, record);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('h1')!.textContent).toBe(record.description);
  });

  it('uses member records for names and safely renders unavailable associations and literal notes', () => {
    const snapshot = fixture('sample', '2026-09-20');
    snapshot.members.find((member) => member.id === 'member-m')!.name =
      'Renamed Member';
    const record = {
      ...snapshot.expenses[0],
      tripId: 'missing-trip',
      note: '<img src=x onerror=alert(1)>\nSecond line',
    };
    render(snapshot, record);
    const current = container.querySelector('.expense-values')!;
    expect(facts(current)['Paid by']).toBe('Renamed Member');
    expect(facts(current).Trip).toBe('Unavailable trip');
    expect(current.querySelector('a')).toBeNull();
    expect(current.querySelector('img')).toBeNull();
    expect(facts(current).Note).toBe(record.note);
  });

  it('preserves the audit revision in shareable and contextual links while ordinary detail uses its own intent', () => {
    act(() =>
      root.render(
        <ExpenseLink id="audit-row" expenseId="record / 1" revision={3}>
          Inspect edited event
        </ExpenseLink>,
      ),
    );
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(
      '/expenses/record%20%2F%201?revision=3',
    );
    act(() => link.click());
    expect(navigation.openContext).toHaveBeenCalledWith(
      '/expenses/record%20%2F%201?revision=3',
      'audit-row',
    );
    expect(navigation.openExpense).not.toHaveBeenCalled();
    act(() =>
      root.render(
        <ExpenseLink id="ordinary-row" expenseId="record / 1">
          Inspect current
        </ExpenseLink>,
      ),
    );
    act(() => container.querySelector('a')!.click());
    expect(navigation.openExpense).toHaveBeenCalledWith(
      'record / 1',
      'ordinary-row',
    );
  });
});
