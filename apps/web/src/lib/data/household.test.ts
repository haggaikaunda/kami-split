import { expect, it, vi } from 'vitest';
import * as fixtures from './fixtures';
import { createEntryPreview } from './entry';
import { createMockData } from './mock';
import type { Command } from './port';
const household = 'household-demo';
async function setup(
  mock: ReturnType<typeof createMockData>,
  name = 'New home',
) {
  await mock.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'first-household',
  });
  await mock.port.entry.dispatch({
    kind: 'request',
    email: 'new@example.test',
  });
  await mock.port.entry.dispatch({ kind: 'follow' });
  return mock.port.entry.dispatch({ kind: 'complete-setup', name });
}
async function snapshot(
  mock: ReturnType<typeof createMockData>,
  id = household,
) {
  const result = await mock.port.read(id);
  if (result.status !== 'ok') throw new Error(result.status);
  return result.value;
}
it('creates one distinct empty household, validates name, and denies old-household replay', async () => {
  const mock = createMockData();
  const prior = await snapshot(mock);
  const invalid = await setup(mock, ' ');
  expect(invalid.problem).toBe('invalid-name');
  expect(await mock.port.read(household)).toEqual({ status: 'denied' });
  const result = await mock.port.entry.dispatch({
    kind: 'complete-setup',
    name: ' New home ',
  });
  expect(result.householdId).not.toBe(household);
  expect(
    await mock.port.entry.dispatch({ kind: 'complete-setup', name: 'Another' }),
  ).toEqual(result);
  const current = await snapshot(mock, result.householdId);
  expect(current.household.name).toBe('New home');
  expect(current.household.currency).toBe('USD');
  expect(current.expenses).toEqual([]);
  expect(current.repayments).toEqual([]);
  expect(current.trips).toEqual([]);
  expect(current.activity).toEqual([]);
  expect(current.members).toHaveLength(1);
  expect(
    await mock.port.execute({
      householdId: household,
      operationId: 'old',
      command: { kind: 'create-expense', value: prior.expenses[0] },
    }),
  ).toEqual({ status: 'denied' });
});
it('enforces owner controls, idempotent invitations/resends and distinct revocation state', async () => {
  const mock = createMockData();
  const run = (operationId: string, command: Command) =>
    mock.port.execute({ householdId: household, operationId, command });
  mock.demo.actor('member-m');
  expect(await run('denied', { kind: 'invite-member', name: 'River' })).toEqual(
    { status: 'denied' },
  );
  expect(
    await run('denied-role', {
      kind: 'change-role',
      memberId: 'member-m',
      role: 'owner',
    }),
  ).toEqual({ status: 'denied' });
  mock.demo.actor('member-k');
  const invited = await run('invite', { kind: 'invite-member', name: 'River' });
  if (invited.status !== 'ok') throw new Error('invite');
  await run('invite', { kind: 'invite-member', name: 'River' });
  expect(
    (await run('duplicate-name', { kind: 'invite-member', name: ' river ' }))
      .status,
  ).toBe('validation');
  await run('resend', { kind: 'resend-invite', memberId: invited.value.id });
  await run('resend', { kind: 'resend-invite', memberId: invited.value.id });
  let members = (await snapshot(mock)).members;
  expect(members.filter((row) => row.name === 'River')).toHaveLength(1);
  expect(members.find((row) => row.name === 'River')?.invitationAttempts).toBe(
    2,
  );
  await run('revoke', { kind: 'revoke-invite', memberId: invited.value.id });
  members = (await snapshot(mock)).members;
  expect(members.find((row) => row.name === 'River')?.status).toBe('inactive');
  expect(
    (
      await run('late-resend', {
        kind: 'resend-invite',
        memberId: invited.value.id,
      })
    ).status,
  ).toBe('validation');
});
it('blocks outstanding balances and last-owner loss, and preserves financial attribution on zero-balance removal', async () => {
  const mock = createMockData();
  const initial = await snapshot(mock);
  const run = (operationId: string, command: Command) =>
    mock.port.execute({ householdId: household, operationId, command });
  expect(
    (
      await run('remove-debtor', {
        kind: 'remove-member',
        memberId: 'member-m',
      })
    ).status,
  ).toBe('validation');
  expect(
    (await run('leave-last', { kind: 'remove-member', memberId: 'member-k' }))
      .status,
  ).toBe('validation');
  expect(
    (
      await run('demote-last', {
        kind: 'change-role',
        memberId: 'member-k',
        role: 'member',
      })
    ).status,
  ).toBe('validation');
  await run('settle', {
    kind: 'record-repayment',
    value: {
      amount: 4218,
      senderId: 'member-k',
      recipientId: 'member-m',
      currency: 'USD',
      effectiveDate: '2026-09-20',
      note: '',
    },
  });
  await run('remove-member', { kind: 'remove-member', memberId: 'member-m' });
  const after = await snapshot(mock);
  expect(after.members.find((row) => row.id === 'member-m')?.status).toBe(
    'inactive',
  );
  expect(after.expenses).toEqual(initial.expenses);
  expect(after.revisions).toEqual(initial.revisions);
  expect(after.members.find((row) => row.id === 'member-m')?.name).toBe(
    'Mizenin',
  );
});
it('allows ownership transfer before leaving and exposes only the same inactive actor self-removal receipt', async () => {
  const mock = createMockData({ fixture: 'empty' });
  const run = (operationId: string, command: Command) =>
    mock.port.execute({ householdId: household, operationId, command });
  await run('transfer', {
    kind: 'change-role',
    memberId: 'member-m',
    role: 'owner',
  });
  mock.demo.scenario('timeout-after-commit');
  expect(
    await run('leave', { kind: 'remove-member', memberId: 'member-k' }),
  ).toEqual({ status: 'unknown' });
  expect(await mock.port.read(household)).toEqual({ status: 'denied' });
  expect(await mock.port.operation(household, 'leave')).toMatchObject({
    status: 'ok',
    value: { id: 'member-k', status: 'inactive' },
  });
  expect(await mock.port.operation(household, 'transfer')).toEqual({
    status: 'denied',
  });
  mock.demo.scenario('expired');
  expect(await mock.port.operation(household, 'leave')).toEqual({
    status: 'expired',
  });
  mock.demo.scenario('denied');
  expect(await mock.port.operation(household, 'leave')).toEqual({
    status: 'denied',
  });
  mock.demo.scenario('normal');
  mock.demo.actor('member-m');
  expect(await mock.port.operation(household, 'leave')).toEqual({
    status: 'not-started',
  });
  mock.demo.actor('member-k');
  await mock.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'existing-member',
  });
  expect(await mock.port.operation(household, 'leave')).toEqual({
    status: 'denied',
  });
  mock.demo.reset('empty');
  expect(await mock.port.operation(household, 'leave')).toEqual({
    status: 'not-started',
  });
});
it('an accepted pending invitation activates its existing identity only once', async () => {
  const mock = createMockData();
  const invite = await mock.port.execute({
    householdId: household,
    operationId: 'invite-existing',
    command: { kind: 'invite-member', name: 'Sam' },
  });
  if (invite.status !== 'ok') throw new Error('invite');
  await mock.port.entry.dispatch({ kind: 'scenario', scenario: 'invitation' });
  await mock.port.entry.dispatch({
    kind: 'request',
    email: 'sam@example.test',
  });
  await mock.port.entry.dispatch({ kind: 'follow' });
  await mock.port.entry.dispatch({ kind: 'accept' });
  await mock.port.entry.dispatch({ kind: 'accept' });
  const after = await snapshot(mock);
  expect(after.actorId).toBe(invite.value.id);
  expect(after.members.filter((row) => row.name === 'Sam')).toHaveLength(1);
  expect(after.members.find((row) => row.name === 'Sam')?.status).toBe(
    'active',
  );
});
it('ignores an old accept action after an owner flow replaced the invitation entry', async () => {
  const mock = createMockData();
  const first = await mock.port.execute({
    householdId: household,
    operationId: 'first',
    command: { kind: 'invite-member', name: 'First' },
  });
  await mock.port.execute({
    householdId: household,
    operationId: 'second',
    command: { kind: 'invite-member', name: 'Second' },
  });
  if (first.status !== 'ok') throw new Error('invite');
  await mock.port.entry.dispatch({ kind: 'scenario', scenario: 'invitation' });
  await mock.port.entry.dispatch({
    kind: 'request',
    email: 'first@example.test',
  });
  const invitation = await mock.port.entry.dispatch({ kind: 'follow' });
  expect(invitation.inviteeName).toBe('First');
  // An owner revokes the selected invite while this preview link remains open.
  await mock.port.entry.dispatch({ kind: 'new-link' });
  await mock.port.entry.dispatch({
    kind: 'request',
    email: 'owner@example.test',
  });
  await mock.port.entry.dispatch({ kind: 'follow' });
  await mock.port.execute({
    householdId: household,
    operationId: 'revoke-first',
    command: { kind: 'revoke-invite', memberId: first.value.id },
  });
  // Replaying the old accept action cannot accept the second person's invitation.
  expect((await mock.port.entry.dispatch({ kind: 'accept' })).phase).toBe(
    'ready',
  );
  expect(
    (await snapshot(mock)).members.find((member) => member.name === 'Second')
      ?.status,
  ).toBe('pending');
});
it('checks non-USD outstanding balances before member removal', async () => {
  const seed = fixtures.fixture('sample', '2026-09-20');
  const expense = seed.expenses.find((row) => row.id === '102')!;
  const overridden = {
    ...seed,
    expenses: [{ ...expense, currency: 'EUR' as const }],
    repayments: [],
  };
  const fixtureSpy = vi.spyOn(fixtures, 'fixture').mockReturnValue(overridden);
  try {
    const mock = createMockData();
    expect(
      await mock.port.execute({
        householdId: household,
        operationId: 'eur-removal',
        command: { kind: 'remove-member', memberId: 'member-m' },
      }),
    ).toMatchObject({
      status: 'validation',
      fields: { member: expect.stringContaining('outstanding balance') },
    });
  } finally {
    fixtureSpy.mockRestore();
  }
});
it('binds acceptance to the shown invitation identity and reports revocation instead of switching identities', async () => {
  const invite = vi.fn(() => false);
  const preview = createEntryPreview({
    deny() {},
    existing() {},
    invitation: () => ({ inviteeId: 'first', inviteeName: 'First' }),
    invite,
    setup() {},
    completeSetup: () => 'new',
    notify() {},
  });
  await preview.port.dispatch({ kind: 'scenario', scenario: 'invitation' });
  await preview.port.dispatch({ kind: 'request', email: 'first@example.test' });
  expect(await preview.port.dispatch({ kind: 'follow' })).toMatchObject({
    inviteeId: 'first',
    inviteeName: 'First',
  });
  expect(await preview.port.dispatch({ kind: 'accept' })).toMatchObject({
    phase: 'error',
    problem: 'revoked-link',
  });
  expect(invite).toHaveBeenCalledExactlyOnceWith('first');
});
it('does not remove a net-zero intermediary who still has direct obligations', async () => {
  const seed = fixtures.fixture('three-members', '2026-09-20');
  const base = seed.expenses[0];
  const overridden = {
    ...seed,
    expenses: [
      {
        ...base,
        id: 'first-edge',
        amount: 100,
        payerId: 'member-k',
        participantIds: ['member-m'],
        allocations: [{ memberId: 'member-m', amount: 100 }],
      },
      {
        ...base,
        id: 'second-edge',
        amount: 100,
        payerId: 'member-m',
        participantIds: ['member-r'],
        allocations: [{ memberId: 'member-r', amount: 100 }],
      },
    ],
    repayments: [],
  };
  const fixtureSpy = vi.spyOn(fixtures, 'fixture').mockReturnValue(overridden);
  try {
    const mock = createMockData();
    expect(
      await mock.port.execute({
        householdId: household,
        operationId: 'net-zero-direct-debt',
        command: { kind: 'remove-member', memberId: 'member-m' },
      }),
    ).toMatchObject({ status: 'validation' });
  } finally {
    fixtureSpy.mockRestore();
  }
});
