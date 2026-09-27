import { expect, it } from 'vitest';
import { createMockData } from './mock';
import type { Command } from './port';

it('independently revalidates owner permission after a delayed invitation instead of trusting the original role', async () => {
  let release = () => {};
  const { port, demo } = createMockData({
    fixture: 'empty',
    delay: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const run = (operationId: string, command: Command) =>
    port.execute({ householdId: 'household-demo', operationId, command });
  expect(
    (
      await run('promote', {
        kind: 'change-role',
        memberId: 'member-m',
        role: 'owner',
      })
    ).status,
  ).toBe('ok');
  demo.scenario('slow');
  const pending = run('late-invite', {
    kind: 'invite-member',
    name: 'Late guest',
  });
  demo.scenario('normal');
  demo.actor('member-m');
  expect(
    (
      await run('demote', {
        kind: 'change-role',
        memberId: 'member-k',
        role: 'member',
      })
    ).status,
  ).toBe('ok');
  demo.actor('member-k');
  release();
  expect(await pending).toEqual({ status: 'denied' });
  const result = await port.read('household-demo');
  if (result.status !== 'ok') throw new Error(result.status);
  expect(result.value.members.map((row) => row.name)).not.toContain(
    'Late guest',
  );
  expect(result.value.activity).toEqual([]);
  expect(await port.operation('household-demo', 'late-invite')).toEqual({
    status: 'not-started',
  });
});

it('independently preserves an active owner when competing demotions reach the same session', async () => {
  const { port, demo } = createMockData({ fixture: 'empty' });
  const run = (operationId: string, command: Command) =>
    port.execute({ householdId: 'household-demo', operationId, command });
  await run('promote', {
    kind: 'change-role',
    memberId: 'member-m',
    role: 'owner',
  });
  demo.actor('member-m');
  const results = await Promise.all([
    run('demote-k', {
      kind: 'change-role',
      memberId: 'member-k',
      role: 'member',
    }),
    run('demote-m', {
      kind: 'change-role',
      memberId: 'member-m',
      role: 'member',
    }),
  ]);
  expect(results.map((row) => row.status)).toEqual(['ok', 'validation']);
  const state = await port.read('household-demo');
  if (state.status !== 'ok') throw new Error(state.status);
  expect(
    state.value.members
      .filter((row) => row.status === 'active' && row.role === 'owner')
      .map((row) => row.id),
  ).toEqual(['member-m']);
});

it('independently limits a departed member receipt to membership data and loses it across a new household boundary', async () => {
  const { port, demo } = createMockData({ fixture: 'empty' });
  const run = (operationId: string, command: Command) =>
    port.execute({ householdId: 'household-demo', operationId, command });
  await run('promote', {
    kind: 'change-role',
    memberId: 'member-m',
    role: 'owner',
  });
  demo.scenario('timeout-after-commit');
  expect(
    await run('leave', { kind: 'remove-member', memberId: 'member-k' }),
  ).toEqual({ status: 'unknown' });
  const receipt = await port.operation('household-demo', 'leave');
  expect(receipt).toEqual({
    status: 'ok',
    value: {
      id: 'member-k',
      name: 'Kaunda',
      role: 'owner',
      status: 'inactive',
    },
  });
  expect(await port.expense('household-demo', '1')).toEqual({
    status: 'denied',
  });
  await port.entry.dispatch({ kind: 'scenario', scenario: 'first-household' });
  await port.entry.dispatch({ kind: 'request', email: 'fixture@example.test' });
  await port.entry.dispatch({ kind: 'follow' });
  const setup = await port.entry.dispatch({
    kind: 'complete-setup',
    name: 'Fresh',
  });
  expect(setup.householdId).not.toBe('household-demo');
  expect(await port.operation('household-demo', 'leave')).toEqual({
    status: 'denied',
  });
  expect(await port.operation(setup.householdId!, 'leave')).toEqual({
    status: 'not-started',
  });
});
