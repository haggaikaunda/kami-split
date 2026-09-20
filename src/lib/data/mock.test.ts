import { describe, expect, it } from 'vitest';
import { equalSplit, positions, spending } from '../ledger';
import { createMockData } from './mock';
import type { DataPort, Envelope, ExpenseInput, Outcome } from './port';
const house = 'household-demo';
export const draft: ExpenseInput = {
  description: 'Coffee together',
  amount: 1001,
  currency: 'USD',
  effectiveDate: '2026-09-20',
  payerId: 'member-k',
  participantIds: ['member-k', 'member-m'],
  allocations: equalSplit(1001, ['member-k', 'member-m']),
  split: 'equal',
  category: 'Dining',
  tripId: null,
  note: '',
};
function ok<T>(result: Outcome<T>): T {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw Error(result.status);
  return result.value;
}
const read = async (port: DataPort) => ok(await port.read(house));
const create = (operationId = 'op-1'): Envelope => ({
  householdId: house,
  operationId,
  command: { kind: 'create-expense', value: structuredClone(draft) },
});

// The replaceable port's contracts can be reused by a future API test harness.
export function dataPortContract(factory: typeof createMockData) {
  describe('application data port contracts', () => {
    it('matches approved seed totals, trips, actor names and chronological audit snapshots', async () => {
      const { port } = factory();
      const state = await read(port);
      expect(spending(state.expenses, { currency: 'USD' }).total).toBe(512656);
      expect(
        spending(state.expenses, {
          currency: 'USD',
          start: '2026-09-01',
          end: '2026-09-30',
        }).total,
      ).toBe(191456);
      expect(
        spending(state.expenses, {
          currency: 'USD',
          start: '2026-01-01',
          end: '2026-12-31',
        }).total,
      ).toBe(366656);
      expect(
        spending(state.expenses, { currency: 'USD', tripId: 'maui' }),
      ).toMatchObject({ total: 164420, count: 7 });
      expect(
        spending(state.expenses, { currency: 'USD', tripId: 'tahoe' }).total,
      ).toBe(84000);
      expect(state.trips.find((row) => row.id === 'porto')).toMatchObject({
        start: '2027-05-12',
        end: '2027-05-18',
      });
      expect(
        positions(
          state.members.map((row) => row.id),
          state.expenses,
          state.repayments,
          'USD',
        ).map((row) => [row.paid, row.net]),
      ).toEqual([
        [249610, -4218],
        [263046, 4218],
      ]);
      expect(state.revisions).toHaveLength(24);
      expect(state.activity).toHaveLength(25);
      expect(state.activity[0].snapshot.id).toBe('1');
    });
    it('creates once under concurrent duplicate requests and rejects operation reuse with altered payload', async () => {
      const { port } = factory();
      const envelope = create();
      const [first, second] = await Promise.all([
        port.execute(envelope),
        port.execute(envelope),
      ]);
      expect(second).toEqual(first);
      const state = await read(port);
      expect(state.expenses).toHaveLength(25);
      expect(state.activity).toHaveLength(26);
      expect(state.revisions).toHaveLength(25);
      expect(
        positions(
          state.members.map((row) => row.id),
          state.expenses,
          state.repayments,
          'USD',
        )[0].net,
      ).toBe(-3718);
      expect(
        await port.execute({
          ...envelope,
          command: {
            kind: 'create-expense',
            value: { ...draft, note: 'different' },
          },
        }),
      ).toEqual({ status: 'operation-conflict' });
      expect(await port.operation(house, 'op-1')).toEqual(first);
    });
    it('returns independent snapshots and strips attempted creator/deletion overrides', async () => {
      const { port } = factory();
      const state = await read(port);
      (
        state.expenses[0].allocations as { memberId: string; amount: number }[]
      )[0] = { memberId: 'member-k', amount: 999 };
      state.household.name = 'tampered';
      expect((await read(port)).household.name).toBe('Our household');
      expect((await read(port)).expenses[0].allocations[0].amount).toBe(4218);
      const envelope = create();
      if (envelope.command.kind === 'create-expense')
        Object.assign(envelope.command.value, {
          creatorId: 'stranger',
          deleted: true,
        });
      const saved = ok(await port.execute(envelope));
      expect(saved).toMatchObject({ creatorId: 'member-k' });
      expect(saved).not.toHaveProperty('deleted');
    });
    it('preserves original creator and immutable complete revisions through edit/delete', async () => {
      const { port, demo } = factory();
      const original = ok(await port.expense(house, '2'));
      demo.actor('member-m');
      const changed = ok(
        await port.execute({
          householdId: house,
          operationId: 'edit',
          command: {
            kind: 'update-expense',
            id: '2',
            expectedVersion: 1,
            value: { ...original, ...draft, note: 'Edited note' },
          },
        }),
      );
      expect(changed).toMatchObject({
        id: '2',
        creatorId: 'member-k',
        version: 2,
        note: 'Edited note',
      });
      expect(ok(await port.expense(house, '2', 1))).toEqual(original);
      const deletion: Envelope = {
        householdId: house,
        operationId: 'delete',
        command: {
          kind: 'delete-expense',
          id: '2',
          expectedVersion: 2,
          reason: 'Duplicate purchase',
        },
      };
      const removed = await port.execute(deletion);
      expect(await port.execute(deletion)).toEqual(removed);
      expect(ok(await port.expense(house, '2'))).toMatchObject({
        deleted: true,
        version: 3,
      });
      const state = await read(port);
      const revisions = state.revisions.filter((row) => row.expenseId === '2');
      expect(revisions.map((row) => row.actorId)).toEqual([
        'member-k',
        'member-m',
        'member-m',
      ]);
      expect(revisions[2].reason).toBe('Duplicate purchase');
      expect(state.activity.filter((row) => row.recordId === '2')).toHaveLength(
        3,
      );
      expect(spending(state.expenses, { currency: 'USD' }).total).toBe(
        512656 - 6800,
      );
    });
    it('rejects stale versions and concurrent deletion without overwriting data', async () => {
      const { port, demo } = factory();
      const original = ok(await port.expense(house, '2'));
      const edit: Envelope = {
        householdId: house,
        operationId: 'edit',
        command: {
          kind: 'update-expense',
          id: '2',
          expectedVersion: 1,
          value: { ...original, note: 'My draft' },
        },
      };
      demo.scenario('second-editor');
      expect(await port.execute(edit)).toMatchObject({
        status: 'conflict',
        current: { version: 2, note: 'Updated by the simulated second editor' },
      });
      expect(
        (await read(port)).revisions.filter((row) => row.expenseId === '2'),
      ).toHaveLength(2);
      demo.scenario('concurrent-delete');
      expect(await port.execute(edit)).toMatchObject({
        status: 'deleted',
        current: { version: 3, deleted: true },
      });
      expect(
        (await read(port)).revisions.filter((row) => row.expenseId === '2'),
      ).toHaveLength(3);
    });
    it('failure before commit is atomic; unknown completion resolves without a duplicate', async () => {
      const { port, demo } = factory();
      const before = await read(port);
      demo.scenario('offline');
      expect(await port.execute(create())).toEqual({ status: 'offline' });
      expect(await read(port)).toEqual(before);
      expect(await port.operation(house, 'op-1')).toEqual({
        status: 'not-started',
      });
      demo.scenario('timeout-after-commit');
      expect(await port.execute(create())).toEqual({ status: 'unknown' });
      expect(await port.operation(house, 'op-1')).toMatchObject({
        status: 'ok',
        value: { description: 'Coffee together' },
      });
      expect(await port.execute(create())).toEqual(
        await port.operation(house, 'op-1'),
      );
      expect((await read(port)).expenses).toHaveLength(25);
    });
    it('enforces simulated household, actor, session and role at the port boundary', async () => {
      const { port, demo } = factory();
      expect(await port.read('other-household')).toEqual({ status: 'denied' });
      expect(
        await port.execute({ ...create(), householdId: 'other-household' }),
      ).toEqual({ status: 'denied' });
      expect(await port.expense('other-household', '2')).toEqual({
        status: 'denied',
      });
      demo.actor('stranger');
      expect(await port.read(house)).toEqual({ status: 'denied' });
      expect(await port.operation(house, 'op-1')).toEqual({ status: 'denied' });
      demo.actor('member-m');
      expect(
        await port.execute({
          householdId: house,
          operationId: 'rename',
          command: { kind: 'update-household', name: 'New' },
        }),
      ).toEqual({ status: 'denied' });
      demo.scenario('expired');
      expect(await port.execute(create())).toEqual({ status: 'expired' });
      expect(await port.expense(house, '2')).toEqual({ status: 'expired' });
      demo.scenario('denied');
      expect(await port.expense(house, '2')).toEqual({ status: 'denied' });
    });
    it('validates complete expense and repayment records without partial audit writes', async () => {
      const { port } = factory();
      const before = await read(port);
      for (const value of [
        { ...draft, amount: 0 },
        { ...draft, description: '' },
        { ...draft, currency: 'EUR' as const },
        { ...draft, effectiveDate: '2026-02-30' },
        { ...draft, tripId: 'missing' },
        { ...draft, category: 'missing' },
        { ...draft, participantIds: [] },
        {
          ...draft,
          allocations: [
            { memberId: 'member-k', amount: 1000 },
            { memberId: 'member-m', amount: 0 },
          ],
        },
      ]) {
        expect(
          await port.execute({
            householdId: house,
            operationId: 'invalid',
            command: { kind: 'create-expense', value },
          }),
        ).toMatchObject({ status: 'validation' });
      }
      expect(
        await port.execute({
          householdId: house,
          operationId: 'repay',
          command: {
            kind: 'record-repayment',
            value: {
              amount: 100,
              currency: 'USD',
              effectiveDate: '2026-09-20',
              senderId: 'member-k',
              recipientId: 'member-k',
              note: '',
            },
          },
        }),
      ).toMatchObject({ status: 'validation' });
      expect(await read(port)).toEqual(before);
      expect(await port.expense(house, 'missing')).toEqual({
        status: 'unavailable',
      });
    });
    it('repayments update positions and audit atomically without altering spending or trip totals', async () => {
      const { port } = factory();
      const before = await read(port);
      const result = await port.execute({
        householdId: house,
        operationId: 'settle',
        command: {
          kind: 'record-repayment',
          value: {
            amount: 4218,
            currency: 'USD',
            effectiveDate: '2026-09-20',
            senderId: 'member-k',
            recipientId: 'member-m',
            note: 'Settled',
          },
        },
      });
      expect(result.status).toBe('ok');
      const after = await read(port);
      expect(after.expenses).toEqual(before.expenses);
      expect(after.revisions).toEqual(before.revisions);
      expect(after.activity).toHaveLength(before.activity.length + 1);
      expect(
        positions(
          after.members.map((row) => row.id),
          after.expenses,
          after.repayments,
          'USD',
        ).map((row) => row.net),
      ).toEqual([0, 0]);
    });
    it('creates trips, validates ranges, supports owner rename, and resets operations and fixture state', async () => {
      const { port, demo } = factory();
      expect(
        await port.execute({
          householdId: house,
          operationId: 'trip',
          command: {
            kind: 'create-trip',
            value: {
              name: 'New trip',
              destination: 'Somewhere',
              start: '2026-12-20',
              end: '2026-12-19',
            },
          },
        }),
      ).toMatchObject({ status: 'validation' });
      expect(
        await port.execute({
          householdId: house,
          operationId: 'trip',
          command: {
            kind: 'create-trip',
            value: {
              name: 'New trip',
              destination: 'Somewhere',
              start: '2026-12-20',
              end: '2026-12-21',
            },
          },
        }),
      ).toMatchObject({ status: 'ok', value: { name: 'New trip' } });
      expect(
        await port.execute({
          householdId: house,
          operationId: 'rename',
          command: { kind: 'update-household', name: 'Our place' },
        }),
      ).toMatchObject({ status: 'ok' });
      demo.reset('empty');
      expect((await read(port)).expenses).toEqual([]);
      expect(await port.operation(house, 'trip')).toEqual({
        status: 'not-started',
      });
      demo.reset('three-members');
      const state = await read(port);
      expect(state.members).toHaveLength(3);
      expect(
        positions(
          state.members.map((row) => row.id),
          state.expenses,
          state.repayments,
          'USD',
        ).reduce((sum, row) => sum + row.net, 0),
      ).toBe(0);
      demo.reset();
      expect((await read(port)).household.name).toBe('Our household');
    });
    it('revalidates actor/reset after delayed requests and never commits an abandoned fixture request', async () => {
      let release = () => {};
      const { port, demo } = factory({
        delay: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      });
      demo.scenario('slow');
      const pending = port.execute(create());
      demo.reset();
      release();
      expect(await pending).toEqual({ status: 'unavailable' });
      expect((await read(port)).expenses).toHaveLength(24);
      demo.scenario('slow');
      const query = port.read(house);
      demo.actor('member-m');
      release();
      expect(await query).toEqual({ status: 'denied' });
    });
  });
}
dataPortContract(createMockData);
