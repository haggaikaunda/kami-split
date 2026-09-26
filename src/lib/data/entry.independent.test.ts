import { describe, expect, it } from 'vitest';
import { createMockData } from './mock';
import type { EntryScenario } from './entry';
import type { ExpenseInput } from './port';
const household = 'household-demo';
async function begin(
  source: ReturnType<typeof createMockData>,
  scenario: EntryScenario,
) {
  await source.port.entry.dispatch({ kind: 'scenario', scenario });
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'independent@example.test',
  });
  return source.port.entry.dispatch({ kind: 'follow' });
}
async function read(source: ReturnType<typeof createMockData>) {
  const result = await source.port.read(household);
  if (result.status !== 'ok') throw new Error('Expected active preview');
  return result.value;
}
describe('independent preview entry requirements', () => {
  it.each([
    'used-link',
    'expired-link',
    'revoked-link',
    'wrong-account',
    'expired-session',
    'first-household',
  ] as const)(
    'blocks financial mutations and record/operation reads for %s without partial writes',
    async (scenario) => {
      const source = createMockData();
      const before = await read(source),
        input: ExpenseInput = {
          ...before.expenses[0],
          description: 'Must not be written',
        };
      await begin(source, scenario);
      expect(
        await source.port.execute({
          householdId: household,
          operationId: 'denied-op',
          command: { kind: 'create-expense', value: input },
        }),
      ).toEqual({ status: 'denied' });
      expect(
        await source.port.expense(household, before.expenses[0].id),
      ).toEqual({ status: 'denied' });
      expect(await source.port.operation(household, 'denied-op')).toEqual({
        status: 'denied',
      });
      await source.port.entry.dispatch({
        kind: 'scenario',
        scenario: 'existing-member',
      });
      await source.port.entry.dispatch({
        kind: 'request',
        email: 'restore@example.test',
      });
      await source.port.entry.dispatch({ kind: 'follow' });
      const restored = await read(source);
      expect(restored.expenses).toEqual(before.expenses);
      expect(restored.revisions).toEqual(before.revisions);
      expect(restored.activity).toEqual(before.activity);
      expect(await source.port.operation(household, 'denied-op')).toEqual({
        status: 'not-started',
      });
    },
  );
  it('cannot accept from request, sent, declined or reset state, and reset clears stale invitations', async () => {
    const source = createMockData();
    await source.port.entry.dispatch({
      kind: 'scenario',
      scenario: 'invitation',
    });
    expect((await source.port.entry.dispatch({ kind: 'accept' })).phase).toBe(
      'request',
    );
    await source.port.entry.dispatch({
      kind: 'request',
      email: 'test@example.test',
    });
    expect((await source.port.entry.dispatch({ kind: 'accept' })).phase).toBe(
      'sent',
    );
    await source.port.entry.dispatch({ kind: 'follow' });
    await source.port.entry.dispatch({ kind: 'decline' });
    expect((await source.port.entry.dispatch({ kind: 'accept' })).phase).toBe(
      'declined',
    );
    expect(await source.port.read(household)).toEqual({ status: 'denied' });
    await begin(source, 'invitation');
    source.demo.reset();
    expect((await source.port.entry.dispatch({ kind: 'accept' })).phase).toBe(
      'request',
    );
    expect(
      (await read(source)).members.some(
        (member) => member.id === 'member-invited',
      ),
    ).toBe(false);
  });
  it('restores the original actor and resolves their retained financial operation without a duplicate', async () => {
    const source = createMockData();
    source.demo.actor('member-m');
    const before = await read(source);
    const envelope = {
      householdId: household,
      operationId: 'retained-original',
      command: {
        kind: 'create-expense' as const,
        value: { ...before.expenses[0], description: 'Retained operation' },
      },
    };
    source.demo.scenario('timeout-after-commit');
    expect(await source.port.execute(envelope)).toEqual({ status: 'unknown' });
    await begin(source, 'expired-session');
    expect(
      await source.port.operation(household, envelope.operationId),
    ).toEqual({ status: 'denied' });
    await source.port.entry.dispatch({ kind: 'new-link' });
    await source.port.entry.dispatch({
      kind: 'request',
      email: 'restore@example.test',
    });
    await source.port.entry.dispatch({ kind: 'follow' });
    const resolved = await source.port.operation(
      household,
      envelope.operationId,
    );
    expect(resolved.status).toBe('ok');
    const after = await read(source);
    expect(after.actorId).toBe('member-m');
    expect(after.expenses).toHaveLength(before.expenses.length + 1);
    expect(
      after.expenses.find(
        (record) => record.description === 'Retained operation',
      )?.creatorId,
    ).toBe('member-m');
    expect(await source.port.execute(envelope)).toEqual(resolved);
    expect((await read(source)).expenses).toHaveLength(after.expenses.length);
  });
});
