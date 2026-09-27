import { describe, expect, it } from 'vitest';
import { equalSplit, positions, spending } from '../ledger';
import { createMockData } from './mock';
import type { Envelope, ExpenseInput, Outcome } from './port';

const householdId = 'household-demo';
const value: ExpenseInput = {
  amount: 1001,
  currency: 'USD',
  effectiveDate: '2026-09-20',
  payerId: 'member-k',
  participantIds: ['member-k', 'member-m'],
  allocations: equalSplit(1001, ['member-k', 'member-m']),
  split: 'equal',
  category: 'Dining',
  tripId: null,
  description: 'Independent probe',
  note: '',
};
const envelope = (): Envelope => ({
  householdId,
  operationId: 'independent',
  command: { kind: 'create-expense', value: structuredClone(value) },
});
function ok<T>(result: Outcome<T>): T {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(result.status);
  return result.value;
}

describe('independent mock adapter acceptance probes', () => {
  it('canonicalizes property order and isolates cached results from caller mutation', async () => {
    const { port } = createMockData();
    const first = await port.execute(envelope());
    const reordered: ExpenseInput = {
      ...(Object.fromEntries(Object.entries(value).reverse()) as ExpenseInput),
      allocations: value.allocations.map(({ memberId, amount }) => ({
        amount,
        memberId,
      })),
    };
    expect(
      await port.execute({
        ...envelope(),
        command: { value: reordered, kind: 'create-expense' },
      }),
    ).toEqual(first);
    const returned = ok(first);
    Object.assign(returned, { description: 'Tampered', amount: 1 });
    expect(await port.operation(householdId, 'independent')).toMatchObject({
      status: 'ok',
      value: { description: value.description, amount: 1001 },
    });
    const state = ok(await port.read(householdId));
    expect(state.expenses).toHaveLength(25);
    state.revisions.at(-1)!.snapshot.description = 'Tampered revision';
    Object.assign(state.activity[0].snapshot, { amount: 0 });
    expect(
      ok(await port.read(householdId)).revisions.at(-1)!.snapshot.description,
    ).toBe(value.description);
    expect(ok(await port.expense(householdId, returned.id, 1)).amount).toBe(
      1001,
    );
  });

  it('does not leak partial records or audit writes when an injected ID source fails mid-commit', async () => {
    let fail = true;
    const { port } = createMockData({
      id: (kind, sequence) => {
        if (kind === 'event' && fail)
          throw new Error('Injected event ID failure');
        return `${kind}-independent-${sequence}`;
      },
    });
    const before = await port.read(householdId);
    expect(await port.execute(envelope())).toMatchObject({
      status: 'validation',
    });
    expect(await port.read(householdId)).toEqual(before);
    expect(await port.operation(householdId, 'independent')).toEqual({
      status: 'not-started',
    });
    fail = false;
    expect(await port.execute(envelope())).toMatchObject({
      status: 'ok',
      value: { id: 'expense-independent-1' },
    });
    const after = ok(await port.read(householdId));
    expect(after.revisions.at(-1)!.id).toBe('revision-independent-2');
    expect(
      after.activity.find(
        (event) => event.recordId === 'expense-independent-1',
      )!.id,
    ).toBe('event-independent-3');
  });

  it('unknown repayment completion binds exactly one financial effect and audit event', async () => {
    const { port, demo } = createMockData();
    const before = ok(await port.read(householdId));
    const repayment: Envelope = {
      householdId,
      operationId: 'repayment-probe',
      command: {
        kind: 'record-repayment',
        value: {
          amount: 4218,
          currency: 'USD',
          senderId: 'member-k',
          recipientId: 'member-m',
          effectiveDate: '2026-09-20',
          note: 'Probe',
        },
      },
    };
    demo.scenario('timeout-after-commit');
    expect(await port.execute(repayment)).toEqual({ status: 'unknown' });
    const result = await port.operation(householdId, repayment.operationId);
    expect(result.status).toBe('ok');
    expect(await port.execute(repayment)).toEqual(result);
    const after = ok(await port.read(householdId));
    expect(after.repayments).toHaveLength(before.repayments.length + 1);
    expect(after.activity).toHaveLength(before.activity.length + 1);
    expect(after.revisions).toEqual(before.revisions);
    expect(spending(after.expenses, { currency: 'USD' }).total).toBe(512656);
    expect(
      positions(
        after.members.map((member) => member.id),
        after.expenses,
        after.repayments,
        'USD',
      ).map((member) => member.net),
    ).toEqual([0, 0]);
  });

  it('captures submitted payload before delay and blocks a command after actor switching', async () => {
    let release = () => {};
    const { port, demo } = createMockData({
      delay: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const request = envelope();
    demo.scenario('slow');
    const pending = port.execute(request);
    if (request.command.kind === 'create-expense')
      request.command.value.description = 'Changed after dispatch';
    release();
    expect(await pending).toMatchObject({
      status: 'ok',
      value: { description: value.description },
    });
    const next = port.execute({ ...envelope(), operationId: 'switched' });
    demo.actor('member-m');
    release();
    expect(await next).toEqual({ status: 'denied' });
    demo.scenario('normal');
    expect(ok(await port.read(householdId)).expenses).toHaveLength(25);
    expect(await port.operation(householdId, 'independent')).toEqual({
      status: 'not-started',
    });
    demo.actor('member-k');
    expect((await port.operation(householdId, 'independent')).status).toBe(
      'ok',
    );
  });

  it('invalidates delayed reads on reset and restores deterministic IDs and operation history', async () => {
    let release = () => {};
    const { port, demo } = createMockData({
      delay: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const first = await port.execute(envelope());
    demo.scenario('slow');
    const pending = port.read(householdId);
    demo.reset('empty');
    release();
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(await port.operation(householdId, 'independent')).toEqual({
      status: 'not-started',
    });
    const empty = ok(await port.read(householdId));
    expect([
      empty.expenses.length,
      empty.repayments.length,
      empty.activity.length,
      empty.revisions.length,
    ]).toEqual([0, 0, 0, 0]);
    demo.reset();
    expect(await port.execute(envelope())).toEqual(first);
  });

  it('isolates session instances and contains subscriber exceptions after commit', async () => {
    const first = createMockData();
    const second = createMockData();
    const unsubscribe = first.port.subscribe(() => {
      throw new Error('Observer failed');
    });
    expect((await first.port.execute(envelope())).status).toBe('ok');
    expect(ok(await first.port.read(householdId)).expenses).toHaveLength(25);
    expect(ok(await second.port.read(householdId)).expenses).toHaveLength(24);
    expect(await second.port.operation(householdId, 'independent')).toEqual({
      status: 'not-started',
    });
    unsubscribe();
  });
});
