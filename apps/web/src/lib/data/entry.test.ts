import { expect, it } from 'vitest';
import { createMockData } from './mock';
import type { EntryScenario } from './entry';
const household = 'household-demo';
async function sent(scenario: EntryScenario) {
  const mock = createMockData();
  await mock.port.entry.dispatch({ kind: 'scenario', scenario });
  await mock.port.entry.dispatch({
    kind: 'request',
    email: 'alex@example.test',
  });
  return mock;
}
it.each([
  'used-link',
  'expired-link',
  'revoked-link',
  'wrong-account',
  'expired-session',
] as const)(
  'denies financial access for %s and exposes a recoverable preview state',
  async (scenario) => {
    const { port } = await sent(scenario);
    expect(await port.entry.dispatch({ kind: 'follow' })).toMatchObject({
      phase: 'error',
      problem: scenario,
    });
    expect(await port.read(household)).toEqual({ status: 'denied' });
    expect(await port.expense(household, '1')).toEqual({ status: 'denied' });
    expect(await port.operation(household, 'anything')).toEqual({
      status: 'denied',
    });
    expect(await port.entry.dispatch({ kind: 'accept' })).toMatchObject({
      phase: 'error',
    });
    if (scenario === 'wrong-account')
      expect(
        await port.entry.dispatch({ kind: 'switch-account' }),
      ).toMatchObject({ phase: 'invitation' });
    else
      expect(await port.entry.dispatch({ kind: 'new-link' })).toMatchObject({
        phase: 'request',
      });
  },
);
it('validates transient email, never retains it, and restores the existing actor through the adapter', async () => {
  const { port, demo } = createMockData();
  demo.actor('member-m');
  expect(
    await port.entry.dispatch({ kind: 'request', email: 'not-email' }),
  ).toMatchObject({ problem: 'invalid-email' });
  expect((await port.entry.read()).phase).toBe('request');
  const value = await port.entry.dispatch({
    kind: 'request',
    email: 'sensitive@example.test',
  });
  expect(JSON.stringify(value)).not.toContain('sensitive');
  expect(await port.read(household)).toEqual({ status: 'denied' });
  await port.entry.dispatch({ kind: 'follow' });
  const read = await port.read(household);
  expect(read.status === 'ok' && read.value.actorId).toBe('member-m');
  expect(JSON.stringify(await port.entry.read())).not.toContain('sensitive');
});
it('accepts an invitation once and does not duplicate membership on repeat acceptance or repeated invitations', async () => {
  const { port } = await sent('invitation');
  await port.entry.dispatch({ kind: 'follow' });
  expect(await port.read(household)).toEqual({ status: 'denied' });
  await Promise.all([
    port.entry.dispatch({ kind: 'accept' }),
    port.entry.dispatch({ kind: 'accept' }),
  ]);
  let read = await port.read(household);
  expect(
    read.status === 'ok' &&
      read.value.members.filter((row) => row.id === 'member-invited'),
  ).toHaveLength(1);
  const generation = read.status === 'ok' && read.value.generation;
  await port.entry.dispatch({ kind: 'accept' });
  read = await port.read(household);
  expect(read.status === 'ok' && read.value.generation).toBe(generation);
  expect(read.status === 'ok' && read.value.actorId).toBe('member-invited');
});
it('declines without membership, remains outside, and cannot accept after decline', async () => {
  const { port, demo } = await sent('invitation');
  await port.entry.dispatch({ kind: 'follow' });
  await port.entry.dispatch({ kind: 'decline' });
  expect(await port.entry.dispatch({ kind: 'accept' })).toMatchObject({
    phase: 'declined',
  });
  expect(await port.read(household)).toEqual({ status: 'denied' });
  demo.reset();
  const read = await port.read(household);
  expect(
    read.status === 'ok' &&
      read.value.members.some((row) => row.id === 'member-invited'),
  ).toBe(false);
});
it('routes first entry to setup-required without exposing the seeded household or creating it', async () => {
  const { port } = await sent('first-household');
  expect(await port.entry.dispatch({ kind: 'follow' })).toMatchObject({
    phase: 'setup-required',
  });
  expect(await port.read(household)).toEqual({ status: 'denied' });
});
