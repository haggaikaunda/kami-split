import { expect, it, vi } from 'vitest';
import { checkedSum, equalSplit, positions } from '../ledger';
import { directObligations } from '../overview';
import * as fixtures from './fixtures';
import { createMockData } from './mock';
import type { Command, ExpenseInput, Snapshot } from './port';

const householdId = 'household-demo';
const expense: ExpenseInput = {
  description: 'Odd-cent shared meal',
  note: '',
  amount: 1001,
  currency: 'USD',
  effectiveDate: '2026-09-20',
  payerId: 'member-k',
  participantIds: ['member-k', 'member-m'],
  allocations: equalSplit(1001, ['member-k', 'member-m']),
  split: 'equal',
  category: 'Dining',
  tripId: null,
};
type Mock = ReturnType<typeof createMockData>;
async function read(mock: Mock): Promise<Snapshot> {
  const result = await mock.port.read(householdId);
  if (result.status !== 'ok') throw new Error(result.status);
  return result.value;
}
function conservation(state: Snapshot) {
  for (const currency of ['USD', 'EUR'] as const) {
    const rows = positions(
      state.members.map((member) => member.id),
      state.expenses,
      state.repayments,
      currency,
    );
    expect(checkedSum(rows.map((row) => row.net))).toBe(0);
    expect(checkedSum(rows.map((row) => row.paid))).toBe(
      checkedSum(rows.map((row) => row.share)),
    );
    expect(checkedSum(rows.map((row) => row.sent))).toBe(
      checkedSum(rows.map((row) => row.received)),
    );
  }
}

it.each(['offline', 'timeout-after-commit'] as const)(
  'independently recovers %s across expense, repayment, and deletion without duplicate events or cents',
  async (scenario) => {
    const mock = createMockData({ fixture: 'empty' });
    async function recover(operationId: string, command: Command) {
      const before = await read(mock);
      const request = { householdId, operationId, command };
      mock.demo.scenario(scenario);
      expect(await mock.port.execute(request)).toEqual({
        status: scenario === 'offline' ? 'offline' : 'unknown',
      });
      const attempted = await read(mock);
      if (scenario === 'offline') {
        expect(attempted).toEqual(before);
        expect(await mock.port.operation(householdId, operationId)).toEqual({
          status: 'not-started',
        });
      } else {
        expect(attempted.activity).toHaveLength(before.activity.length + 1);
        expect(
          (await mock.port.operation(householdId, operationId)).status,
        ).toBe('ok');
      }
      const result = await mock.port.execute(request);
      expect(result.status).toBe('ok');
      const committed = await read(mock);
      expect(committed.activity).toHaveLength(before.activity.length + 1);
      expect(await mock.port.execute(request)).toEqual(result);
      expect(await mock.port.operation(householdId, operationId)).toEqual(
        result,
      );
      expect(await read(mock)).toEqual(committed);
      conservation(committed);
      if (result.status !== 'ok') throw new Error(result.status);
      return result.value.id;
    }
    const id = await recover('meal', {
      kind: 'create-expense',
      value: expense,
    });
    const created = await read(mock);
    await recover('payment', {
      kind: 'record-repayment',
      value: {
        amount: 500,
        currency: 'USD',
        senderId: 'member-m',
        recipientId: 'member-k',
        effectiveDate: '2026-09-20',
        note: 'Settled meal',
      },
    });
    expect(directObligations(await read(mock), 'USD')).toEqual([]);
    await recover('delete', {
      kind: 'delete-expense',
      id,
      expectedVersion: 1,
      reason: 'Receipt voided',
    });
    const final = await read(mock);
    expect(
      final.activity
        .toSorted((a, b) => a.sequence - b.sequence)
        .map((row) => row.kind),
    ).toEqual(['created', 'repayment', 'deleted']);
    expect(final.revisions).toHaveLength(2);
    expect(
      final.activity.find((row) => row.id === created.activity[0].id),
    ).toEqual(created.activity[0]);
    expect(final.revisions[0]).toEqual(created.revisions[0]);
    expect(await mock.port.expense(householdId, id, 1)).toEqual({
      status: 'ok',
      value: created.expenses[0],
    });
    expect(final.expenses[0]).toMatchObject({ id, deleted: true, version: 2 });
    expect(final.repayments).toHaveLength(1);
    expect(
      positions(
        final.members.map((row) => row.id),
        final.expenses,
        final.repayments,
        'USD',
      ).map((row) => row.net),
    ).toEqual([-500, 500]);
    // An operation ID cannot be reused for a different financial journey.
    expect(
      await mock.port.execute({
        householdId,
        operationId: 'meal',
        command: {
          kind: 'delete-expense',
          id,
          expectedVersion: 2,
          reason: 'Changed request',
        },
      }),
    ).toEqual({ status: 'operation-conflict' });
    expect(await read(mock)).toEqual(final);
  },
);

it('independently blocks historical financial changes after settlement and removal but permits an auditable note correction', async () => {
  const mock = createMockData({ fixture: 'empty' });
  const run = (operationId: string, command: Command) =>
    mock.port.execute({ householdId, operationId, command });
  const created = await run('expense', {
    kind: 'create-expense',
    value: expense,
  });
  if (created.status !== 'ok') throw new Error(created.status);
  const id = created.value.id;
  expect(
    (
      await run('settle', {
        kind: 'record-repayment',
        value: {
          amount: 500,
          currency: 'USD',
          senderId: 'member-m',
          recipientId: 'member-k',
          effectiveDate: '2026-09-20',
          note: '',
        },
      })
    ).status,
  ).toBe('ok');
  expect(
    (await run('remove', { kind: 'remove-member', memberId: 'member-m' }))
      .status,
  ).toBe('ok');
  const before = await read(mock);
  for (const command of [
    {
      kind: 'update-expense',
      id,
      expectedVersion: 1,
      value: {
        ...expense,
        amount: 1201,
        allocations: equalSplit(1201, expense.participantIds),
      },
    },
    {
      kind: 'delete-expense',
      id,
      expectedVersion: 1,
      reason: 'Historical deletion',
    },
  ] satisfies Command[]) {
    expect((await run(command.kind, command)).status).toBe('validation');
    expect(await read(mock)).toEqual(before);
    expect(await mock.port.operation(householdId, command.kind)).toEqual({
      status: 'not-started',
    });
  }
  expect(
    (
      await run('note', {
        kind: 'update-expense',
        id,
        expectedVersion: 1,
        value: { ...expense, note: 'Corrected receipt reference' },
      })
    ).status,
  ).toBe('ok');
  const after = await read(mock);
  expect(after.revisions[0]).toEqual(before.revisions[0]);
  expect(
    after.activity.filter((row) =>
      before.activity.some((prior) => prior.id === row.id),
    ),
  ).toEqual(before.activity);
  expect(after.activity[0]).toMatchObject({
    kind: 'edited',
    actorId: 'member-k',
  });
  expect(after.expenses[0]).toMatchObject({
    version: 2,
    amount: 1001,
    note: 'Corrected receipt reference',
  });
  expect(directObligations(after, 'USD')).toEqual([]);
  conservation(after);
});

it('independently rejects deleting settled EUR history after member removal without mutating revisions', async () => {
  const seed = fixtures.fixture('empty', '2026-09-20');
  const historical = {
    ...expense,
    currency: 'EUR' as const,
    id: 'eur-history',
    creatorId: 'member-k',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    version: 1,
  };
  const spy = vi.spyOn(fixtures, 'fixture').mockReturnValue({
    ...seed,
    expenses: [historical],
    repayments: [
      {
        id: 'eur-settlement',
        amount: 500,
        currency: 'EUR',
        senderId: 'member-m',
        recipientId: 'member-k',
        effectiveDate: '2026-09-20',
        note: '',
        creatorId: 'member-k',
        createdAt: historical.createdAt,
      },
    ],
    revisions: [
      {
        id: 'eur-revision',
        expenseId: historical.id,
        version: 1,
        actorId: 'member-k',
        at: historical.createdAt,
        reason: '',
        snapshot: historical,
      },
    ],
  });
  try {
    const mock = createMockData({ fixture: 'empty' });
    expect(
      (
        await mock.port.execute({
          householdId,
          operationId: 'remove',
          command: { kind: 'remove-member', memberId: 'member-m' },
        })
      ).status,
    ).toBe('ok');
    const before = await read(mock);
    expect(
      (
        await mock.port.execute({
          householdId,
          operationId: 'delete-eur',
          command: {
            kind: 'delete-expense',
            id: historical.id,
            expectedVersion: 1,
            reason: '',
          },
        })
      ).status,
    ).toBe('validation');
    expect(await read(mock)).toEqual(before);
    conservation(before);
  } finally {
    spy.mockRestore();
  }
});

it('independently restricts unknown financial receipts to their actor and household across denied, expired, and reset states', async () => {
  const mock = createMockData({ fixture: 'empty' });
  const request = {
    householdId,
    operationId: 'uncertain-expense',
    command: { kind: 'create-expense' as const, value: expense },
  };
  mock.demo.scenario('timeout-after-commit');
  expect(await mock.port.execute(request)).toEqual({ status: 'unknown' });
  const committed = await read(mock);
  mock.demo.actor('member-m');
  expect(await mock.port.operation(householdId, request.operationId)).toEqual({
    status: 'not-started',
  });
  mock.demo.actor('member-k');
  for (const status of ['denied', 'expired', 'offline'] as const) {
    mock.demo.scenario(status);
    expect(await mock.port.operation(householdId, request.operationId)).toEqual(
      { status },
    );
  }
  mock.demo.scenario('normal');
  expect(
    await mock.port.operation('another-household', request.operationId),
  ).toEqual({ status: 'denied' });
  expect(await mock.port.operation(householdId, request.operationId)).toEqual({
    status: 'ok',
    value: committed.expenses[0],
  });
  expect(await mock.port.execute(request)).toEqual({
    status: 'ok',
    value: committed.expenses[0],
  });
  const recovered = await read(mock);
  expect(recovered.expenses).toEqual(committed.expenses);
  expect(recovered.repayments).toEqual(committed.repayments);
  expect(recovered.activity).toEqual(committed.activity);
  expect(recovered.revisions).toEqual(committed.revisions);
  mock.demo.reset('empty');
  expect(await mock.port.operation(householdId, request.operationId)).toEqual({
    status: 'not-started',
  });
  const reset = await read(mock);
  expect(reset.expenses).toEqual([]);
  expect(reset.activity).toEqual([]);
  expect(reset.revisions).toEqual([]);
});
