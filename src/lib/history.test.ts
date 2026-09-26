import { describe, expect, it } from 'vitest';
import { fixture } from './data/fixtures';
import type { Activity, ExpenseRecord, Snapshot } from './data/port';
import { historyDate, historyDescription, historyEvents } from './history';
const all = { search: '', type: 'all', member: 'all' };
function sample() {
  return fixture('three-members', '2026-09-20');
}
function event(snapshot: Snapshot, patch: Partial<Activity> = {}): Activity {
  const row = snapshot.expenses.find((row) => row.id === '102')!;
  return {
    id: 'event-test',
    sequence: 100,
    at: '2026-09-20T12:00:00.000Z',
    actorId: 'member-r',
    kind: 'edited',
    recordId: row.id,
    snapshot: structuredClone(row),
    ...patch,
  };
}
describe('immutable activity history', () => {
  it('sorts by event timestamp then descending sequence, independently of expense dates', () => {
    const snapshot = sample();
    const one = event(snapshot, { id: 'one', sequence: 1 });
    const two = event(snapshot, { id: 'two', sequence: 2 });
    const newer = event(snapshot, {
      id: 'newer',
      sequence: 0,
      at: '2026-09-21T12:00:00.000Z',
    });
    snapshot.activity = [one, newer, two];
    expect(historyEvents(snapshot, all).map((row) => row.id)).toEqual([
      'newer',
      'two',
      'one',
    ]);
    expect(snapshot.activity.map((row) => row.id)).toEqual([
      'one',
      'newer',
      'two',
    ]);
    snapshot.activity = [
      event(snapshot, { id: 'laterUtc', at: '2026-09-20T11:30:00Z' }),
      event(snapshot, { id: 'earlierOffset', at: '2026-09-20T12:00:00+01:00' }),
    ];
    expect(historyEvents(snapshot, all).map((row) => row.id)).toEqual([
      'laterUtc',
      'earlierOffset',
    ]);
  });
  it('filters zero-share included participants and payers, never the editor alone', () => {
    const snapshot = sample();
    const row = event(snapshot);
    row.snapshot = {
      ...(row.snapshot as ExpenseRecord),
      participantIds: ['member-k', 'member-m'],
      allocations: [
        { memberId: 'member-k', amount: 8620 },
        { memberId: 'member-m', amount: 0 },
      ],
    };
    snapshot.activity = [row];
    expect(
      historyEvents(snapshot, { ...all, member: 'member-m' }),
    ).toHaveLength(1);
    expect(
      historyEvents(snapshot, { ...all, member: 'member-k' }),
    ).toHaveLength(1);
    expect(
      historyEvents(snapshot, { ...all, member: 'member-r' }),
    ).toHaveLength(0);
  });
  it('includes either repayment party, excludes unrelated creator, and searches its displayed description', () => {
    const snapshot = sample();
    const row = snapshot.repayments[0];
    snapshot.activity = [
      event(snapshot, { kind: 'repayment', snapshot: row, recordId: row.id }),
    ];
    for (const member of [row.senderId, row.recipientId])
      expect(historyEvents(snapshot, { ...all, member })).toHaveLength(1);
    expect(
      historyEvents(snapshot, { ...all, member: 'member-r' }),
    ).toHaveLength(0);
    expect(
      historyEvents(snapshot, { ...all, search: ' REPAID ' }),
    ).toHaveLength(1);
    expect(historyDescription(snapshot.activity[0], snapshot)).toContain(
      'repaid',
    );
  });
  it('retains original creation and edit descriptions/revisions even after deletion', () => {
    const snapshot = sample();
    const row = event(snapshot);
    const original = { ...row, id: 'original', kind: 'created' as const };
    const edited = {
      ...row,
      id: 'edited',
      snapshot: {
        ...(row.snapshot as ExpenseRecord),
        description: 'Revised dinner',
        version: 2,
      },
    };
    const deleted = {
      ...edited,
      id: 'deleted',
      kind: 'deleted' as const,
      snapshot: { ...edited.snapshot, version: 3, deleted: true },
    };
    snapshot.activity = [original, edited, deleted];
    snapshot.expenses = [deleted.snapshot];
    expect(historyEvents(snapshot, { ...all, type: 'created' })).toEqual([
      original,
    ]);
    expect(historyEvents(snapshot, { ...all, type: 'edited' })).toEqual([
      edited,
    ]);
    expect(historyEvents(snapshot, { ...all, type: 'deleted' })).toEqual([
      deleted,
    ]);
    expect(historyEvents(snapshot, { ...all, search: 'POKE' })).toEqual([
      original,
    ]);
    expect(historyEvents(snapshot, { ...all, search: 'revised' })).toHaveLength(
      2,
    );
  });
  it('combines filters and handles unknown values as empty, not a silent reset', () => {
    const snapshot = sample();
    expect(
      historyEvents(snapshot, {
        search: 'Poke',
        type: 'created',
        member: 'member-k',
      }),
    ).toHaveLength(1);
    expect(historyEvents(snapshot, { ...all, type: 'missing' })).toHaveLength(
      0,
    );
    expect(historyEvents(snapshot, { ...all, member: 'missing' })).toHaveLength(
      0,
    );
  });
  it('always includes the year, and distinguishes event timestamp from effective date', () => {
    expect(historyDate('2025-12-31')).toBe('Dec 31, 2025');
    expect(historyDate('2026-09-20T12:00:00.000Z', true)).toContain(
      'Sep 20, 2026',
    );
    expect(historyDate('2026-09-20T12:00:00.000Z', true)).toContain('UTC');
  });
});
