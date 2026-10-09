/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local fixture server. */
// Synthetic visual evidence only. All API calls terminate here; none reach Next or hosted services.
// Start Next on :3227, then node scripts/visual-parity-fixture.cjs. Open :3228/household.
// ?fixtureTheme=light|dark|system and ?fixtureState select evidence states; /__fixture/health lists every state.
// Group/repayment/invitation success is opt-in via write-success, no-workspaces or owner-invitations.
// Auth onboarding uses only haggai@example.com / SyntheticOnly123! and inert synthetic-* invitation links.
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { parse } = require('graphql');
const assert = require('node:assert/strict');
const upstream = new URL(
  process.env.FIXTURE_UPSTREAM || 'http://127.0.0.1:3227',
);
if (!['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname))
  throw new Error(
    'The synthetic fixture accepts only a loopback Next upstream.',
  );
const port = Number(process.env.FIXTURE_PORT || 3228);
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'haggai@example.com',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T12:00:00Z',
};
function session() {
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const access_token =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, exp: expires, aud: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.c3ludGhldGlj';
  return {
    access_token,
    refresh_token: 'synthetic-refresh',
    expires_in: 86400,
    expires_at: expires,
    token_type: 'bearer',
    user,
  };
}
const members = ['You', 'Alex', 'Sam', 'Maya'].map((displayName, index) => ({
  id: `M${index}`,
  displayName,
  status: 'ACTIVE',
  role: index ? 'MEMBER' : 'OWNER',
  canParticipate: true,
}));
const groups = [
  {
    id: 'H',
    name: 'Home',
    kind: 'ORDINARY',
    isHousehold: true,
    currency: 'USD',
    trip: null,
  },
  {
    id: 'F',
    name: 'Maple House',
    kind: 'ORDINARY',
    isHousehold: false,
    currency: 'USD',
    trip: null,
  },
  {
    id: 'T',
    name: 'Coast weekend',
    kind: 'TRIP',
    isHousehold: false,
    currency: 'USD',
    trip: {
      destination: 'Pacific coast',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    },
  },
];
// Keep public IDs identical across Group and GroupSummary, matching the real
// resolvers (expenses.resolvers.go and view_mapping.go). Their distinct Relay
// record identities must be handled by the application, never hidden by fixtures.
const groupSummary = (value) => ({ __typename: 'GroupSummary', ...value });
// The 16 rows, payer distribution, integer amounts and rounding offsets come from the approved reference.
const raw = [
  [
    'F',
    'Weekly groceries',
    '8640',
    0,
    'GROCERIES',
    '2026-10-08',
    'Groceries for the week.',
  ],
  ['F', 'Internet', '6400', 1, 'HOME', '2026-10-07', 'October internet bill.'],
  [
    'T',
    'Campsite',
    '16800',
    0,
    'ACCOMMODATION',
    '2026-10-07',
    'Two nights by the coast.',
  ],
  [
    'T',
    'Ferry tickets',
    '8400',
    1,
    'TRANSPORT',
    '2026-10-06',
    'Return tickets for all four of us.',
  ],
  ['T', 'Dinner by the beach', '6400', 2, 'DINING', '2026-10-05', ''],
  ['T', 'Morning coffee', '1200', 3, 'DINING', '2026-10-05', ''],
  ['F', 'Sunday dinner', '12800', 3, 'DINING', '2026-10-04', ''],
  ['F', 'Household supplies', '4260', 0, 'HOME', '2026-10-03', ''],
  ['F', 'House rent', '31150', 0, 'ACCOMMODATION', '2026-10-02', ''],
  ['F', 'Electricity', '16350', 1, 'HOME', '2026-10-02', '', 2],
  ['F', 'Guest room booking', '26800', 2, 'ACCOMMODATION', '2026-10-01', ''],
  ['F', 'Home essentials', '18400', 3, 'HOME', '2026-10-01', ''],
  ['T', 'Fuel', '9100', 0, 'TRANSPORT', '2026-10-02', ''],
  ['T', 'Kayak hire', '7600', 1, 'ACTIVITIES', '2026-10-02', ''],
  ['T', 'Lunch on the road', '3500', 2, 'DINING', '2026-10-01', ''],
  ['T', 'Park passes', '3800', 3, 'ACTIVITIES', '2026-10-01', ''],
];
function equalAllocations(amount, participants = members, offset = 0) {
  const total = BigInt(amount),
    count = BigInt(participants.length);
  return participants.map((participant, index) => ({
    participant,
    amountMinor: String(
      total / count +
        (BigInt((index + participants.length - offset) % participants.length) <
        total % count
          ? 1n
          : 0n),
    ),
    percentageHundredths: null,
  }));
}
function freshExpenses() {
  return raw.map(
    (
      [
        groupId,
        description,
        totalMinor,
        payer,
        category,
        effectiveDate,
        note,
        offset,
      ],
      index,
    ) => ({
      __typename: 'Expense',
      id: `expense-${index}`,
      groupId,
      version: '1',
      canEdit: true,
      editLockReason: null,
      description,
      totalMinor,
      payer: members[payer],
      category,
      effectiveDate,
      note: note || '',
      currency: 'USD',
      createdAt: `${effectiveDate}T12:00:00Z`,
      creator: members[0],
      split: 'EQUAL',
      allocations: equalAllocations(totalMinor, members, offset),
    }),
  );
}
function financialInvariants(expenses) {
  for (const expense of expenses) {
    assert.match(expense.totalMinor, /^\d+$/);
    assert.ok(expense.payer, 'Every fixture expense has one payer.');
    const owed = expense.allocations.reduce((sum, allocation) => {
      assert.match(allocation.amountMinor, /^\d+$/);
      assert.ok(
        allocation.participant,
        'Every fixture allocation has a participant.',
      );
      return sum + BigInt(allocation.amountMinor);
    }, 0n);
    assert.equal(
      owed,
      BigInt(expense.totalMinor),
      'Fixture shares sum exactly to the expense total.',
    );
  }
  return {
    valid: true,
    expenseCount: String(expenses.length),
    totalMinor: String(
      expenses.reduce((sum, expense) => sum + BigInt(expense.totalMinor), 0n),
    ),
  };
}
function percentageAllocations(amount, percentages) {
  const total = BigInt(amount);
  assert.equal(
    percentages.reduce((sum, entry) => sum + entry.hundredths, 0),
    10000,
  );
  const entries = percentages.map((entry, index) => ({
    participant: members.find((member) => member.id === entry.participantId),
    amount: (total * BigInt(entry.hundredths)) / 10000n,
    remainder: (total * BigInt(entry.hundredths)) % 10000n,
    percentageHundredths: entry.hundredths,
    index,
  }));
  let remaining =
    total - entries.reduce((sum, entry) => sum + entry.amount, 0n);
  const byRemainder = [...entries].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const entry of byRemainder)
    if (remaining > 0n) {
      entry.amount++;
      remaining--;
    }
  return entries.map((entry) => ({
    participant: entry.participant,
    amountMinor: String(entry.amount),
    percentageHundredths: entry.percentageHundredths,
  }));
}
const clients = new Map();
const writeStates = new Set([
  'write-success',
  'no-workspaces',
  'owner-invitations',
]);
const onboardingStates = new Set([
  'signed-out',
  'join-targeted',
  'join-shared',
  'join-wrong-account',
]);
const fixtureStates = [
  'complete',
  'empty',
  'error',
  'loading',
  'long-names',
  'huge',
  'denied',
  'conflict',
  'recovery',
  'write-success',
  'no-workspaces',
  'owner-invitations',
  'member',
  'single-category',
  'tiny-category',
  ...onboardingStates,
];
const fixtureNow = '2026-10-09T12:00:00Z';
const fixtureExpiry = '2026-10-16T12:00:00Z';
function newClient() {
  return {
    signedOut: false,
    appearance: 'LIGHT',
    displayName: 'Haggai',
    expenses: freshExpenses(),
    groups: structuredClone(groups),
    createdGroups: new Set(),
    repayments: [],
    invitations: [],
    invitationContext: null,
    invitationOperations: new Map(),
    writeOperations: new Map(),
    state: 'complete',
    conflictUsed: false,
    operations: new Map(),
  };
}
function setState(client, state) {
  if (client.state === state) return;
  if (state === 'huge' || client.state === 'huge') {
    client.expenses = freshExpenses();
    client.operations.clear();
    if (state === 'huge')
      for (const expense of client.expenses) {
        const scale = 1000000000003n;
        expense.totalMinor = String(BigInt(expense.totalMinor) * scale);
        expense.allocations = expense.allocations.map((allocation) => ({
          ...allocation,
          amountMinor: String(BigInt(allocation.amountMinor) * scale),
        }));
      }
  }
  client.conflictUsed = false;
  client.state = state;
  if (state === 'single-category')
    client.expenses = freshExpenses().filter(
      (expense) => expense.category === 'GROCERIES',
    );
  if (state === 'tiny-category') {
    client.expenses = freshExpenses();
    client.expenses[0].totalMinor = '1';
    client.expenses[0].allocations = equalAllocations('1');
  }
  if (state === 'no-workspaces' || state.startsWith('join-')) {
    client.groups = [];
    client.expenses = [];
    client.repayments = [];
  }
  if (onboardingStates.has(state))
    client.signedOut = state !== 'join-wrong-account';
  if (state === 'owner-invitations')
    client.invitations = [
      {
        id: 'synthetic-shared',
        groupID: 'F',
        kind: 'SHARED',
        recipient: null,
        expiresAt: fixtureExpiry,
        lifecycle: 'OUTSTANDING',
        actionID: 'synthetic-shared-action',
        delivery: 'NOT_REQUESTED',
      },
      {
        id: 'synthetic-targeted',
        groupID: 'F',
        kind: 'TARGETED',
        recipient: 'invitee@example.com',
        expiresAt: fixtureExpiry,
        lifecycle: 'OUTSTANDING',
        actionID: 'synthetic-targeted-action',
        delivery: 'PROVIDER_ACCEPTED',
      },
      {
        id: 'synthetic-revoked',
        groupID: 'F',
        kind: 'TARGETED',
        recipient: null,
        expiresAt: fixtureExpiry,
        lifecycle: 'REVOKED',
        actionID: 'synthetic-revoked-action',
        delivery: 'NOT_REQUESTED',
      },
    ];
  financialInvariants(client.expenses);
}
function groupMembers(client, id) {
  const entries = client.createdGroups.has(id) ? members.slice(0, 1) : members;
  return entries.map((member, index) => ({
    ...member,
    role:
      client.state === 'member' || client.state.startsWith('join-')
        ? index === 1
          ? 'OWNER'
          : 'MEMBER'
        : member.role,
  }));
}
function longNames(value) {
  if (Array.isArray(value)) return value.map(longNames);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['name', 'displayName'].includes(key) && typeof item === 'string'
        ? `${item} — Cedar Grove household and coast weekend friends with a deliberately long shared workspace name`
        : key === 'description' && typeof item === 'string'
          ? `${item} with all the additional details for everyone sharing this cost`.slice(
              0,
              70,
            )
          : longNames(item),
    ]),
  );
}
function matching(client, groupId, filter = {}) {
  filter ||= {};
  if (client.state === 'empty') return [];
  return client.expenses
    .filter(
      (expense) =>
        (!groupId || expense.groupId === groupId) &&
        (!filter.groupId || expense.groupId === filter.groupId) &&
        (!filter.category || expense.category === filter.category) &&
        (!filter.from || expense.effectiveDate >= filter.from) &&
        (!filter.to || expense.effectiveDate <= filter.to) &&
        (!filter.memberId ||
          expense.payer.id === filter.memberId ||
          expense.allocations.some(
            (a) => a.participant.id === filter.memberId,
          )),
    )
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}
function total(expenses, select = (e) => e.totalMinor) {
  return expenses.reduce((sum, e) => sum + BigInt(select(e) || 0), 0n);
}
function share(expenses, member = members[0]) {
  return total(
    expenses,
    (e) =>
      e.allocations.find((a) => a.participant.id === member.id)?.amountMinor,
  );
}
function paid(expenses, member = members[0]) {
  return total(expenses.filter((e) => e.payer.id === member.id));
}
function balances(client, id) {
  const expenses = matching(client, id),
    transfers = client.repayments.filter((record) => record.groupId === id),
    positions = groupMembers(client, id).map((member) => ({
      member,
      paidMinor: String(paid(expenses, member)),
      owedMinor: String(share(expenses, member)),
      sentMinor: String(
        total(
          transfers.filter((r) => r.sender.id === member.id),
          (r) => r.amountMinor,
        ),
      ),
      receivedMinor: String(
        total(
          transfers.filter((r) => r.recipient.id === member.id),
          (r) => r.amountMinor,
        ),
      ),
      netMinor: String(
        paid(expenses, member) -
          share(expenses, member) +
          total(
            transfers.filter((r) => r.sender.id === member.id),
            (r) => r.amountMinor,
          ) -
          total(
            transfers.filter((r) => r.recipient.id === member.id),
            (r) => r.amountMinor,
          ),
      ),
    }));
  const creditors = positions
    .filter((p) => BigInt(p.netMinor) > 0n)
    .map((p) => ({ ...p, remaining: BigInt(p.netMinor) }));
  const debtors = positions
    .filter((p) => BigInt(p.netMinor) < 0n)
    .map((p) => ({ ...p, remaining: -BigInt(p.netMinor) }));
  const obligations = [];
  for (const debtor of debtors)
    for (const creditor of creditors) {
      const amount =
        debtor.remaining < creditor.remaining
          ? debtor.remaining
          : creditor.remaining;
      if (amount)
        obligations.push({
          from: debtor.member,
          to: creditor.member,
          amountMinor: String(amount),
        });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
    }
  return {
    __typename: 'GroupBalances',
    groupId: id,
    revision: '1',
    totalExpenseMinor: String(total(expenses)),
    settled: obligations.length === 0,
    positions,
    obligations,
  };
}
function expenseView(client, id, filter, limit = 20, after) {
  const expenses = matching(client, id, filter),
    start = after ? expenses.findIndex((e) => e.id === after) + 1 : 0;
  const page = expenses.slice(start, start + limit),
    categories = [...new Set(expenses.map((e) => e.category))];
  return {
    __typename: 'ExpenseView',
    __isExpenseViewResult: 'ExpenseView',
    contextVersion: 'visual-fixture-v1',
    totalExpenseMinor: String(total(expenses)),
    viewerShareMinor: String(share(expenses)),
    viewerPaidMinor: String(paid(expenses)),
    expenseCount: String(expenses.length),
    categories: categories.map((category) => {
      const entries = expenses.filter((e) => e.category === category);
      return {
        category,
        totalExpenseMinor: String(total(entries)),
        viewerShareMinor: String(share(entries)),
        expenseCount: String(entries.length),
      };
    }),
    months: [...new Set(expenses.map((e) => e.effectiveDate.slice(0, 7)))].map(
      (month) => {
        const entries = expenses.filter((e) =>
          e.effectiveDate.startsWith(month),
        );
        return {
          month,
          totalExpenseMinor: String(total(entries)),
          expenseCount: String(entries.length),
        };
      },
    ),
    edges: page.map((node) => ({
      cursor: node.id,
      node,
      source: groupSummary(client.groups.find((g) => g.id === node.groupId)),
    })),
    pageInfo: {
      hasNextPage: start + limit < expenses.length,
      hasPreviousPage: start > 0,
      startCursor: page[0]?.id || null,
      endCursor: page.at(-1)?.id || null,
    },
  };
}
function group(client, id, limit = 20) {
  const found = client.groups.find((g) => g.id === id);
  if (!found) return problem('NOT_FOUND');
  const view = expenseView(client, id, null, limit);
  return {
    __typename: 'Group',
    ...found,
    viewerMembership: groupMembers(client, id)[0],
    members: groupMembers(client, id),
    expenses: { ...view, revision: '1' },
    repayments: {
      edges: client.repayments
        .filter((r) => r.groupId === id)
        .map((node) => ({ node, cursor: node.id })),
      pageInfo: { hasNextPage: false, endCursor: null },
      revision: '1',
    },
    balances: balances(client, id),
  };
}
function dashboard(client) {
  const expenses = matching(client);
  return {
    __typename: 'HouseholdDashboard',
    state: 'COMPLETE',
    contextVersion: 'visual-fixture-v1',
    totals: {
      __typename: 'HouseholdDashboardTotals',
      viewerNetMinor: String(
        client.groups.reduce(
          (sum, g) =>
            sum + BigInt(balances(client, g.id).positions[0]?.netMinor || '0'),
          0n,
        ),
      ),
      viewerShareMinor: String(share(expenses)),
      viewerPaidMinor: String(paid(expenses)),
      openBalanceCount: String(
        client.groups.filter((g) => !balances(client, g.id).settled).length,
      ),
      activeSpaceCount: String(client.groups.length),
      totalSharedExpenseMinor: String(total(expenses)),
      totalSharedExpenseCount: String(expenses.length),
    },
    spaces: client.groups.map((g) => ({
      ...g,
      id: undefined,
      groupId: g.id,
      viewerMembership: groupMembers(client, g.id)[0],
      members: groupMembers(client, g.id),
      viewerNetMinor: balances(client, g.id).positions[0].netMinor,
      sharedExpenseCount: String(matching(client, g.id).length),
      balances: balances(client, g.id),
    })),
  };
}
function activity(client, id, filter = {}) {
  filter ||= {};
  const repayments = client.repayments
    .filter((record) => !id || record.groupId === id)
    .map((record) => {
      const source = client.groups.find((group) => group.id === record.groupId);
      return {
        cursor: `activity-${record.id}`,
        node: {
          __typename: 'ActivityEvent',
          id: `activity-${record.id}`,
          recordId: record.id,
          description: null,
          note: record.note,
          before: null,
          after: null,
          kind: 'REPAYMENT_RECORDED',
          groupId: record.groupId,
          groupName: source.name,
          groupKind: source.kind,
          isHousehold: source.isHousehold,
          amountMinor: record.amountMinor,
          currency: 'USD',
          effectiveDate: record.effectiveDate,
          timestamp: record.createdAt,
          creator: record.creator,
          payer: null,
          sender: record.sender,
          recipient: record.recipient,
        },
      };
    });
  return {
    __typename: 'ActivityConnection',
    __isActivityResult: 'ActivityConnection',
    edges: [
      ...repayments,
      ...matching(client, id).map((e) => {
        const g = client.groups.find((item) => item.id === e.groupId);
        return {
          cursor: `activity-${e.id}`,
          node: {
            __typename: 'ActivityEvent',
            id: `activity-${e.id}`,
            recordId: e.id,
            description: e.description,
            note: e.note,
            before: null,
            after: e,
            kind: 'EXPENSE_CREATED',
            groupId: e.groupId,
            groupName: g.name,
            groupKind: g.kind,
            isHousehold: g.isHousehold,
            amountMinor: e.totalMinor,
            currency: 'USD',
            effectiveDate: e.effectiveDate,
            timestamp: e.createdAt,
            creator: e.payer,
            payer: e.payer,
            sender: null,
            recipient: null,
          },
        };
      }),
    ].filter(
      ({ node }) =>
        (!filter.kind || node.kind === filter.kind) &&
        (!filter.sourceGroupId || node.groupId === filter.sourceGroupId),
    ),
    pageInfo: { hasNextPage: false, endCursor: null },
  };
}
function problem(code = 'UNAVAILABLE') {
  return { __typename: 'Problem', code, message: 'Synthetic fixture response' };
}
function createGroup(client, input) {
  if (!writeStates.has(client.state)) return problem('UNAVAILABLE');
  const key = `group:${input.operationKey}`,
    prior = client.writeOperations.get(key),
    signature = JSON.stringify(input);
  if (prior)
    return prior.signature === signature
      ? prior.result
      : {
          __typename: 'GroupCreationConflict',
          operationKey: input.operationKey,
        };
  const fields = [];
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    [...input.name].length > 120
  )
    fields.push({
      path: ['input', 'name'],
      code: 'INVALID_INPUT',
      message: 'Enter a group name.',
    });
  if (
    !['ORDINARY', 'TRIP'].includes(input.kind) ||
    (input.kind === 'TRIP' &&
      (!input.trip ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.trip.startDate) ||
        input.trip.endDate < input.trip.startDate))
  )
    fields.push({
      path: ['input', 'trip'],
      code: 'INVALID_INPUT',
      message: 'Enter valid trip dates.',
    });
  let result;
  if (fields.length)
    result = {
      __typename: 'GroupCreationRejected',
      operationKey: input.operationKey,
      fields,
    };
  else {
    const id = `synthetic-group-${randomUUID()}`;
    client.groups.push({
      id,
      name: input.name.trim(),
      kind: input.kind,
      isHousehold: false,
      currency: 'USD',
      trip: input.kind === 'TRIP' ? structuredClone(input.trip) : null,
    });
    client.createdGroups.add(id);
    result = {
      __typename: 'GroupCreationCompleted',
      operationKey: input.operationKey,
      groupId: id,
      creatorMembershipId: 'M0',
      createdAt: fixtureNow,
    };
  }
  client.writeOperations.set(key, { signature, result });
  return result;
}
function recordRepayment(client, input) {
  if (!writeStates.has(client.state)) return problem('UNAVAILABLE');
  const key = `repayment:${input.groupId}:${input.key}`,
    prior = client.writeOperations.get(key),
    signature = JSON.stringify(input);
  if (prior)
    return prior.signature === signature
      ? prior.result
      : { __typename: 'OperationMismatch', key: input.key };
  if (!client.groups.some((g) => g.id === input.groupId))
    return problem('NOT_FOUND');
  const people = groupMembers(client, input.groupId),
    sender = people.find((m) => m.id === input.senderId),
    recipient = people.find((m) => m.id === input.recipientId);
  if (
    !sender ||
    !recipient ||
    sender.id === recipient.id ||
    !/^[1-9]\d*$/.test(input.amountMinor) ||
    BigInt(input.amountMinor) > 999999999n ||
    input.currency !== 'USD'
  )
    return {
      __typename: 'ValidationProblem',
      fields: [
        {
          path: ['input', 'amountMinor'],
          code: 'INVALID_INPUT',
          message: 'Use distinct group members and valid exact USD cents.',
        },
      ],
    };
  const record = {
    __typename: 'Repayment',
    id: `synthetic-repayment-${randomUUID()}`,
    groupId: input.groupId,
    creator: people[0],
    sender,
    recipient,
    amountMinor: input.amountMinor,
    currency: 'USD',
    effectiveDate: input.effectiveDate,
    note: input.note || '',
    createdAt: fixtureNow,
    revision: '2',
  };
  client.repayments.unshift(record);
  const result = {
    __typename: 'RepaymentCommitted',
    key: input.key,
    record: {
      repaymentId: record.id,
      groupId: record.groupId,
      creatorMembershipId: 'M0',
      senderMembershipId: sender.id,
      recipientMembershipId: recipient.id,
      amountMinor: record.amountMinor,
      currency: 'USD',
      effectiveDate: record.effectiveDate,
      note: record.note,
      committedAt: fixtureNow,
      revision: '2',
    },
  };
  assert.equal(
    balances(client, input.groupId).positions.reduce(
      (sum, p) => sum + BigInt(p.netMinor),
      0n,
    ),
    0n,
    'Synthetic repayments change sender and recipient equally and oppositely.',
  );
  client.writeOperations.set(key, { signature, result });
  return result;
}
function invitationResponse(client, query, variables) {
  const field = [
    'ownerInvitations',
    'createTargetedInvitation',
    'createSharedInvitation',
    'resendInvitation',
    'renewSharedInvitation',
    'revokeInvitation',
    'retryInvitationDelivery',
    'invitationAction',
  ].find((name) => new RegExp(`\\b${name}\\s*\\(`).test(query));
  if (!field) return null;
  const denied = (code) => ({
    [field]: {
      __typename: 'InvitationProblem',
      code,
      message: 'Synthetic invitation response',
    },
  });
  if (client.state === 'member' || client.state === 'denied')
    return denied('FORBIDDEN');
  if (field === 'ownerInvitations')
    return {
      ownerInvitations: {
        __typename: 'OwnerInvitationPage',
        items: client.invitations.filter(
          (item) => item.groupID === variables.groupID,
        ),
        nextCursor: null,
      },
    };
  if (!writeStates.has(client.state)) return denied('UNAVAILABLE');
  if (field === 'invitationAction')
    return {
      invitationAction: client.invitationOperations.get(variables.key)
        ?.result || {
        __typename: 'InvitationActionResult',
        outcome: 'NOT_OBSERVED',
        hasAccess: false,
      },
    };
  if (field === 'retryInvitationDelivery') {
    const item = client.invitations.find(
      (item) => item.actionID === variables.actionID,
    );
    if (!item) return denied('NOT_FOUND');
    item.delivery = 'PROVIDER_ACCEPTED';
    return {
      retryInvitationDelivery: {
        __typename: 'InvitationDeliveryResult',
        status: 'ATTEMPTED',
      },
    };
  }
  if (!client.groups.some((g) => g.id === variables.groupID))
    return denied('NOT_FOUND');
  const signature = JSON.stringify({ field, ...variables }),
    prior = client.invitationOperations.get(variables.key);
  if (prior)
    return {
      [field]:
        prior.signature === signature
          ? prior.result
          : {
              __typename: 'InvitationActionResult',
              outcome: 'KEY_REUSED',
              hasAccess: false,
            },
    };
  const shared =
    field === 'createSharedInvitation' || field === 'renewSharedInvitation';
  if (
    field === 'createTargetedInvitation' &&
    !/^[^@\s]+@example\.(?:com|test)$/.test(variables.email || '')
  )
    return denied('INVALID_EMAIL');
  let item = client.invitations.find(
    (item) =>
      item.groupID === variables.groupID &&
      (variables.id
        ? item.id === variables.id
        : item.lifecycle === 'OUTSTANDING' &&
          (shared
            ? item.kind === 'SHARED'
            : item.recipient === variables.email)),
  );
  let outcome = 'SAVED';
  if (field.startsWith('create')) {
    if (item) outcome = 'EXISTING';
    else {
      item = {
        id: `synthetic-invitation-${randomUUID()}`,
        groupID: variables.groupID,
        kind: shared ? 'SHARED' : 'TARGETED',
        recipient: shared ? null : variables.email,
        expiresAt: fixtureExpiry,
        lifecycle: 'OUTSTANDING',
        actionID: `synthetic-action-${randomUUID()}`,
        delivery: shared ? 'NOT_REQUESTED' : 'PENDING',
      };
      client.invitations.push(item);
    }
  } else {
    if (!item) return denied('NOT_FOUND');
    if (['REVOKED', 'ACCEPTED'].includes(item.lifecycle))
      outcome =
        item.lifecycle === 'REVOKED' ? 'ALREADY_REVOKED' : 'ALREADY_ACCEPTED';
    else {
      outcome = 'APPLIED';
      if (field === 'revokeInvitation') {
        item.lifecycle = 'REVOKED';
        item.recipient = null;
        item.delivery = 'NOT_REQUESTED';
      } else {
        item.expiresAt = fixtureExpiry;
        item.delivery = shared ? 'NOT_REQUESTED' : 'PENDING';
      }
      item.actionID = `synthetic-action-${randomUUID()}`;
    }
  }
  const result = {
    __typename: 'InvitationActionResult',
    actionID: item.actionID,
    invitationID: item.id,
    groupID: item.groupID,
    outcome,
    committedExpiresAt: item.expiresAt,
    currentExpiresAt: item.expiresAt,
    lifecycle: item.lifecycle,
    delivery: item.delivery,
    hasAccess: false,
  };
  client.invitationOperations.set(variables.key, { signature, result });
  return { [field]: result };
}
function onboardingResponse(client, action, input, origin) {
  const fail = (code, status = 400) => ({ body: { code }, status });
  const ok = (body) => ({ body, status: 200 });
  if (action === 'copy-shared') {
    if (!writeStates.has(client.state) || client.state === 'member')
      return fail('FORBIDDEN', 403);
    const invitation = client.invitations.find(
      (item) =>
        item.id === input.invitationID &&
        item.groupID === input.groupID &&
        item.kind === 'SHARED' &&
        item.lifecycle === 'OUTSTANDING',
    );
    return invitation
      ? ok({ link: `${origin}/join?fixtureState=join-shared#synthetic-shared` })
      : fail('UNAVAILABLE_LINK');
  }
  if (!onboardingStates.has(client.state)) return fail('UNAVAILABLE', 503);
  if (action === 'start') {
    if (
      input.token &&
      !['synthetic-targeted', 'synthetic-shared'].includes(input.token)
    )
      return fail('UNAVAILABLE_LINK');
    client.invitationContext = {
      kind: input.token === 'synthetic-shared' ? 'SHARED' : 'TARGETED',
      digest: createHash('sha256')
        .update(input.token || '')
        .digest('hex'),
    };
    return ok({ code: 'READY' });
  }
  if (!client.invitationContext) return fail('CONTEXT_EXPIRED');
  if (action === 'preview')
    return ok({
      kind: client.invitationContext.kind,
      groupName: 'Maple House',
      inviterDisplayName: 'Alex',
    });
  if (
    ['targeted-continuation', 'accept', 'provision'].includes(action) &&
    input.tokenDigest !== client.invitationContext.digest
  )
    return fail('ORIGINAL_LINK_REQUIRED', 409);
  if (action === 'targeted-continuation') {
    if (client.state === 'join-wrong-account')
      return fail('WRONG_ACCOUNT', 409);
    if (!client.signedOut) return ok({ code: 'ALREADY_AUTHENTICATED' });
    return ok({
      tokenHash: '0'.repeat(64),
      type: 'invite',
      needsPassword: true,
    });
  }
  if (action === 'callback-state')
    return input.state === 'synthetic-callback'
      ? ok({ code: 'READY', tokenDigest: client.invitationContext.digest })
      : fail('INVALID_CALLBACK');
  if (['provision', 'recover'].includes(action))
    return ok({
      code: 'CHECK_EMAIL',
      message: 'Synthetic fixture only; no email is sent.',
    });
  if (action === 'accept') {
    if (client.state === 'join-wrong-account')
      return ok({ code: 'WRONG_ACCOUNT' });
    if (client.signedOut) return fail('UNAUTHENTICATED', 401);
    if (!client.groups.some((group) => group.id === 'F')) {
      client.groups.push(
        structuredClone(groups.find((group) => group.id === 'F')),
      );
      client.expenses = freshExpenses().filter(
        (expense) => expense.groupId === 'F',
      );
    }
    return ok({ code: 'ADMITTED', groupID: 'F', hasAccess: true });
  }
  return fail('UNAVAILABLE', 503);
}
function projectResponse(query, variables, data) {
  const document = parse(query);
  const fragments = new Map(
    document.definitions
      .filter((item) => item.kind === 'FragmentDefinition')
      .map((item) => [item.name.value, item]),
  );
  const select = (value, selections) => {
    if (value == null) return value;
    if (Array.isArray(value))
      return value.map((item) => select(item, selections));
    const result = {};
    for (const field of selections) {
      if (
        field.directives?.some((directive) => {
          const arg = directive.arguments.find(
            (item) => item.name.value === 'if',
          )?.value;
          const flag =
            arg?.kind === 'Variable' ? variables[arg.name.value] : arg?.value;
          return directive.name.value === 'include'
            ? !flag
            : directive.name.value === 'skip' && flag;
        })
      )
        continue;
      if (field.kind === 'FragmentSpread')
        Object.assign(
          result,
          select(
            value,
            fragments.get(field.name.value).selectionSet.selections,
          ),
        );
      else if (field.kind === 'InlineFragment') {
        if (
          !field.typeCondition ||
          !value.__typename ||
          field.typeCondition.name.value === value.__typename ||
          field.typeCondition.name.value === 'Node'
        )
          Object.assign(result, select(value, field.selectionSet.selections));
      } else {
        const name = field.name.value,
          key = field.alias?.value || name;
        result[key] = field.selectionSet
          ? select(value[name], field.selectionSet.selections)
          : value[name];
      }
    }
    return result;
  };
  return select(
    data,
    document.definitions.find((item) => item.kind === 'OperationDefinition')
      .selectionSet.selections,
  );
}
function graphql(client, query, variables = {}) {
  const requestedFirst = (field, fallback = 20) =>
    Number(
      query.match(
        new RegExp(`\\b${field}\\s*\\([^)]*\\bfirst:\\s*(\\d+)`),
      )?.[1] || fallback,
    );
  const op = query.match(/(?:query|mutation)\s+(\w+)/)?.[1];
  const profile = {
    __typename: 'Profile',
    id: 'profile',
    displayName: client.displayName,
    appearance: client.appearance,
  };
  const viewer = {
    __typename: 'Viewer',
    id: 'viewer',
    displayName: client.displayName,
    today: '2026-10-09',
    canCreateGroups: true,
    groups: client.groups.map(groupSummary),
  };
  let data;
  switch (op) {
    case 'appearanceQuery':
    case 'profileQuery':
      data = { currentProfile: profile };
      break;
    case 'appearanceMutation':
      client.appearance = variables.appearance;
      data = {
        updateMyAppearance: { ...profile, appearance: client.appearance },
      };
      break;
    case 'profileMutation':
      client.displayName = variables.displayName;
      data = {
        updateMyProfile: { ...profile, displayName: client.displayName },
      };
      break;
    case 'householdAccessQuery':
    case 'journeyViewerQuery':
      data = { viewer };
      break;
    case 'journeyWorkspaceQuery':
      data = {
        viewer,
        group: group(client, variables.id, requestedFirst('expenses')),
        ...(variables.ledger
          ? {
              groupExpenses: expenseView(
                client,
                variables.id,
                variables.filter,
                requestedFirst('groupExpenses'),
              ),
            }
          : {}),
        ...(variables.activity
          ? { groupActivity: activity(client, variables.id) }
          : {}),
      };
      break;
    case 'journeyGroupQuery':
    case 'householdMembersQuery':
    case 'expenseEditMembersQuery':
      data = { group: group(client, variables.id || variables.groupId) };
      break;
    case 'householdWorkspaceQuery':
      data = {
        householdDashboard: dashboard(client),
        ...(variables.recent
          ? {
              householdExpenses: expenseView(
                client,
                null,
                null,
                requestedFirst('householdExpenses', 4),
              ),
            }
          : {}),
      };
      break;
    case 'expensesHouseholdInitialQuery':
      data = {
        viewer,
        householdDashboard: dashboard(client),
        householdExpenses: expenseView(
          client,
          null,
          variables.filter,
          requestedFirst('householdExpenses'),
        ),
      };
      break;
    case 'expensesHouseholdContextQuery':
      data = { viewer, householdDashboard: dashboard(client) };
      break;
    case 'expensesHouseholdQuery':
      data = {
        householdExpenses: expenseView(
          client,
          null,
          variables.filter,
          requestedFirst('householdExpenses'),
          variables.after,
        ),
      };
      break;
    case 'expensesGroupQuery':
      data = {
        groupExpenses: expenseView(
          client,
          variables.groupId,
          variables.filter,
          requestedFirst('groupExpenses'),
          variables.after,
        ),
      };
      break;
    case 'activityHouseholdQuery':
      data = { householdActivity: activity(client, null, variables.filter) };
      break;
    case 'activityGroupQuery':
      data = {
        groupActivity: activity(client, variables.groupId, variables.filter),
      };
      break;
    case 'activityDetailQuery':
      data = {
        activityEvent:
          activity(client).edges.find((e) => e.node.id === variables.eventId)
            ?.node || problem('NOT_FOUND'),
      };
      break;
    case 'journeyExpenseQuery':
      data = {
        node: client.expenses.find((e) => e.id === variables.id) || null,
      };
      break;
    case 'journeyCreateMutation':
    case 'expenseEditMutation': {
      const input = variables.input,
        edit = op === 'expenseEditMutation';
      if (client.operations.has(input.key)) {
        data = client.operations.get(input.key);
        break;
      }
      const participants = input.participantIds
        .map((id) => members.find((m) => m.id === id))
        .filter(Boolean);
      const old = client.expenses.find((e) => e.id === input.expenseId);
      if (edit && client.state === 'conflict' && !client.conflictUsed && old) {
        client.conflictUsed = true;
        old.version = String(BigInt(old.version) + 1n);
        old.description = 'Weekly groceries updated by Alex';
      }
      if (edit && input.expectedVersion !== old?.version) {
        data = {
          updateExpense: {
            __typename: 'ExpenseEditConflict',
            key: input.key,
            currentVersion: old?.version || '1',
          },
        };
        client.operations.set(input.key, data);
        break;
      }
      const record = {
        __typename: 'Expense',
        ...input,
        id: edit ? input.expenseId : `expense-${randomUUID()}`,
        version: String(BigInt(old?.version || '0') + 1n),
        currency: 'USD',
        canEdit: true,
        editLockReason: null,
        createdAt: old?.createdAt || '2026-10-09T12:00:00Z',
        creator: members[0],
        payer: members.find((m) => m.id === input.payerId),
        allocations: input.exactAllocations
          ? input.exactAllocations.map((a) => ({
              participant: members.find((m) => m.id === a.participantId),
              amountMinor: a.amountMinor,
              percentageHundredths: null,
            }))
          : input.percentages
            ? percentageAllocations(input.totalMinor, input.percentages)
            : equalAllocations(input.totalMinor, participants),
        note: input.note || '',
      };
      financialInvariants([record]);
      client.expenses = edit
        ? client.expenses.map((e) => (e.id === input.expenseId ? record : e))
        : [record, ...client.expenses];
      financialInvariants(client.expenses);
      data = {
        [edit ? 'updateExpense' : 'createExpense']: {
          __typename: edit ? 'ExpenseEditCommitted' : 'ExpenseCommitted',
          key: input.key,
          version: record.version,
          changed: true,
          record: {
            expenseId: record.id,
            groupId: record.groupId,
            totalMinor: record.totalMinor,
            revision: '2',
            split: record.split,
            allocations: record.allocations.map((a) => ({
              participantId: a.participant.id,
              amountMinor: a.amountMinor,
              percentageHundredths: a.percentageHundredths,
            })),
          },
        },
      };
      client.operations.set(input.key, data);
      if (client.state === 'recovery')
        data = {
          [edit ? 'updateExpense' : 'createExpense']: {
            __typename: 'OperationProgress',
            key: input.key,
            state: 'UNKNOWN',
          },
        };
      break;
    }
    case 'journeyRecoveryQuery':
      data = {
        expenseOperation: client.operations.get(variables.key)
          ?.createExpense || {
          __typename: 'OperationProgress',
          key: variables.key,
          state: 'NOT_OBSERVED',
        },
      };
      break;
    case 'expenseEditRecoveryQuery':
      data = {
        updateExpenseOperation: client.operations.get(variables.key)
          ?.updateExpense || {
          __typename: 'OperationProgress',
          key: variables.key,
          state: 'NOT_OBSERVED',
        },
      };
      break;
    case 'journeyRepaymentMutation':
      data = { recordRepayment: recordRepayment(client, variables.input) };
      break;
    case 'journeyRepaymentRecoveryQuery':
      data = {
        repaymentOperation: client.writeOperations.get(
          `repayment:${variables.groupId}:${variables.key}`,
        )?.result || {
          __typename: 'OperationProgress',
          key: variables.key,
          state: 'NOT_OBSERVED',
        },
      };
      break;
    case 'journeyGroupCreationMutation':
      data = { createGroup: createGroup(client, variables.input) };
      break;
    case 'journeyGroupCreationRecoveryQuery':
      data = {
        groupCreationOperation: client.writeOperations.get(
          `group:${variables.operationKey}`,
        )?.result || {
          __typename: 'GroupCreationNotStarted',
          operationKey: variables.operationKey,
        },
      };
      break;
    default:
      if ((data = invitationResponse(client, query, variables))) break;
      else if (/^\s*mutation\b/.test(query))
        throw new Error(
          'Unsupported synthetic mutation; no production request sent.',
        );
      else if (query.includes('viewer')) data = { viewer };
      else if (query.includes('group('))
        data = {
          group: group(client, variables.id || variables.groupId || 'H'),
        };
      else
        throw new Error(
          `Unhandled synthetic GraphQL operation: ${op || 'anonymous'}`,
        );
  }
  if (client.state === 'error' || client.state === 'denied')
    for (const key of Object.keys(data))
      if (!['viewer', 'currentProfile'].includes(key))
        data[key] =
          key === 'node'
            ? null
            : problem(client.state === 'denied' ? 'NOT_FOUND' : 'UNAVAILABLE');
  if (client.state === 'long-names') data = longNames(data);
  return { data: projectResponse(query, variables, data) };
}
function json(response, value, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
const server = http.createServer(async (request, response) => {
  try {
    const origin = `http://${request.headers.host}`,
      url = new URL(request.url, origin);
    const cookies = Object.fromEntries(
      (request.headers.cookie || '')
        .split(';')
        .filter((c) => c.includes('='))
        .map((c) => c.trim().split('=')),
    );
    const id = cookies['kami-visual-fixture'] || randomUUID();
    if (!clients.has(id)) clients.set(id, newClient());
    const client = clients.get(id);
    if (
      ['light', 'dark', 'system'].includes(url.searchParams.get('fixtureTheme'))
    )
      client.appearance = url.searchParams.get('fixtureTheme').toUpperCase();
    if (fixtureStates.includes(url.searchParams.get('fixtureState')))
      setState(client, url.searchParams.get('fixtureState'));
    response.setHeader(
      'Set-Cookie',
      `kami-visual-fixture=${id}; Path=/; SameSite=Lax; HttpOnly`,
    );
    if (url.pathname === '/__fixture/health')
      return json(response, {
        synthetic: true,
        upstream: upstream.origin,
        state: client.state,
        appearance: client.appearance,
        availableStates: fixtureStates,
        syntheticWritesEnabled: writeStates.has(client.state),
      });
    if (url.pathname === '/__fixture/invariants')
      return json(response, {
        ...financialInvariants(client.expenses),
        repaymentCount: String(client.repayments.length),
        groups: client.groups.map((group) => {
          const positions = balances(client, group.id).positions;
          const net = positions.reduce(
            (sum, position) => sum + BigInt(position.netMinor),
            0n,
          );
          assert.equal(net, 0n);
          return { groupId: group.id, netMinor: String(net) };
        }),
      });
    if (url.pathname === '/__fixture/bootstrap.js') {
      response.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      return response.end(
        `${client.signedOut ? "localStorage.removeItem('kami-auth');" : `localStorage.setItem('kami-auth',${JSON.stringify(JSON.stringify(session()))});`}document.currentScript.remove();`,
      );
    }
    if (url.pathname === '/__fixture/reset') {
      clients.set(id, newClient());
      return json(response, { reset: true });
    }
    if (url.pathname === '/api/onboarding-config')
      return json(response, {
        url: origin + '/synthetic-auth',
        key: 'synthetic-public',
      });
    if (url.pathname === '/api/onboarding/clear') {
      client.invitationContext = null;
      return json(response, {});
    }
    if (url.pathname.startsWith('/api/onboarding/')) {
      if (request.method !== 'POST')
        return json(response, { code: 'METHOD_NOT_ALLOWED' }, 405);
      const result = onboardingResponse(
        client,
        url.pathname.slice('/api/onboarding/'.length),
        JSON.parse((await readBody(request)) || '{}'),
        origin,
      );
      return json(response, result.body, result.status);
    }
    if (url.pathname === '/synthetic-auth/auth/v1/logout') {
      client.signedOut = true;
      return json(response, {});
    }
    if (
      url.pathname === '/synthetic-auth/auth/v1/token' &&
      url.searchParams.get('grant_type') === 'password'
    ) {
      const input = JSON.parse((await readBody(request)) || '{}');
      if (
        !onboardingStates.has(client.state) ||
        input.email !== user.email ||
        input.password !== 'SyntheticOnly123!'
      )
        return json(
          response,
          {
            error: 'invalid_grant',
            error_description: 'Use the documented synthetic fixture identity.',
          },
          400,
        );
      client.signedOut = false;
      return json(response, session());
    }
    if (url.pathname === '/synthetic-auth/auth/v1/verify') {
      const input = JSON.parse((await readBody(request)) || '{}');
      if (
        !onboardingStates.has(client.state) ||
        input.token_hash !== '0'.repeat(64)
      )
        return json(
          response,
          {
            error: 'invalid_grant',
            error_description: 'Synthetic verification unavailable.',
          },
          400,
        );
      client.signedOut = false;
      return json(response, session());
    }
    if (
      url.pathname === '/synthetic-auth/auth/v1/user' &&
      request.method === 'PUT'
    ) {
      const input = JSON.parse((await readBody(request)) || '{}');
      if (
        !onboardingStates.has(client.state) ||
        client.signedOut ||
        input.password !== 'SyntheticOnly123!'
      )
        return json(
          response,
          {
            code: 'UNAVAILABLE',
            message:
              'Use only the documented synthetic password in explicit onboarding states.',
          },
          400,
        );
      return json(response, user);
    }
    if (
      url.pathname === '/synthetic-auth/auth/v1/user' &&
      request.method === 'GET'
    )
      return client.signedOut
        ? json(response, { code: 'UNAUTHENTICATED' }, 401)
        : json(response, user);
    if (
      url.pathname === '/synthetic-auth/auth/v1/token' &&
      url.searchParams.get('grant_type') === 'refresh_token'
    )
      return client.signedOut
        ? json(response, { code: 'UNAUTHENTICATED' }, 401)
        : json(response, session());
    if (url.pathname.startsWith('/synthetic-auth/'))
      return json(
        response,
        { code: 'UNAVAILABLE', message: 'Unsupported synthetic auth action.' },
        503,
      );
    if (url.pathname === '/api/graphql') {
      if (client.signedOut)
        return json(response, { code: 'UNAUTHENTICATED' }, 401);
      const body = JSON.parse(await readBody(request));
      if (
        client.state === 'loading' &&
        !/\b(?:appearanceQuery|profileQuery)\b/.test(body.query)
      )
        await new Promise((resolve) => setTimeout(resolve, 30000));
      return json(response, graphql(client, body.query, body.variables));
    }
    if (url.pathname.startsWith('/api/'))
      return json(
        response,
        {
          code: 'UNAVAILABLE',
          message:
            'Synthetic fixture: this action cannot reach hosted services.',
        },
        503,
      );
    if (!['GET', 'HEAD'].includes(request.method))
      return json(response, { code: 'SYNTHETIC_READ_ONLY_PROXY' }, 405);
    const headers = {
      ...request.headers,
      host: upstream.host,
      'accept-encoding': 'identity',
    };
    delete headers.cookie;
    delete headers.authorization;
    const result = await fetch(new URL(url.pathname + url.search, upstream), {
      headers,
      redirect: 'manual',
    });
    for (const [key, value] of result.headers)
      if (
        ![
          'content-length',
          'content-encoding',
          'transfer-encoding',
          'set-cookie',
        ].includes(key)
      )
        response.setHeader(key, value);
    response.statusCode = result.status;
    if (result.headers.get('content-type')?.includes('text/html')) {
      const html = await result.text();
      const seed = '<script src="/__fixture/bootstrap.js"></script>';
      response.end(html.replace('<head>', '<head>' + seed));
    } else response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    if (!response.headersSent) json(response, { error: error.message }, 500);
    else response.end();
  }
});
// Next development waits for its HMR connection before hydrating. Forward only
// its local socket; this is unnecessary (and unused) for a production build.
server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/_next/')) return socket.destroy();
  const proxy = http.request(new URL(request.url, upstream), {
    headers: { ...request.headers, host: upstream.host },
  });
  proxy.on('upgrade', (result, target, targetHead) => {
    socket.write(`HTTP/1.1 ${result.statusCode} ${result.statusMessage}\r\n`);
    for (let index = 0; index < result.rawHeaders.length; index += 2)
      socket.write(
        `${result.rawHeaders[index]}: ${result.rawHeaders[index + 1]}\r\n`,
      );
    socket.write('\r\n');
    if (targetHead.length) socket.write(targetHead);
    if (head.length) target.write(head);
    target.pipe(socket).pipe(target);
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });
  proxy.on('error', () => socket.destroy());
  proxy.end();
});
server.listen(port, process.env.FIXTURE_HOST || '0.0.0.0', () =>
  console.log(
    `Synthetic visual fixture: http://localhost:${port}/household → ${upstream.origin}; no API requests are forwarded.`,
  ),
);
