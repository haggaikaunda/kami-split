// Synthetic expense fixtures adapted from navigation-browser.cjs. No real data.
const members = ['Alex', 'Brian', 'Casey'].map((displayName, i) => ({
  id: 'M' + i,
  displayName,
  status: 'ACTIVE',
  role: i ? 'MEMBER' : 'OWNER',
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
    id: 'T',
    name: 'Maui 2026 with a very long friendly space name',
    kind: 'TRIP',
    isHousehold: false,
    currency: 'USD',
    trip: {
      destination: 'Maui',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
    },
  },
  {
    id: 'F',
    name: 'Friends',
    kind: 'ORDINARY',
    isHousehold: false,
    currency: 'USD',
    trip: null,
  },
];
function group(id) {
  return {
    __typename: 'Group',
    ...groups.find((g) => g.id === id),
    viewerMembership: members[0],
    members,
    expenses: {
      id: `ExpenseConnection:${id}:1`,
      revision: '1',
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    },
    repayments: { edges: [], pageInfo: { hasNextPage: false } },
    balances: {
      __typename: 'GroupBalances',
      groupId: id,
      revision: '1',
      totalExpenseMinor: '300',
      settled: false,
      positions: members.map((member, i) => ({
        member,
        paidMinor: '0',
        owedMinor: '0',
        sentMinor: '0',
        receivedMinor: '0',
        netMinor: i === 0 ? '8420' : i === 1 ? '-8420' : '0',
      })),
      obligations: [{ from: members[1], to: members[0], amountMinor: '8420' }],
    },
  };
}

const expense = {
  __typename: 'Expense',
  id: 'e1',
  groupId: 'T',
  version: '1',
  canEdit: true,
  editLockReason: null,
  split: 'EQUAL',
  description: 'Fixture lunch',
  effectiveDate: '2026-10-01',
  totalMinor: '300',
  category: 'GROCERIES',
  note: null,
  payer: members[0],
  allocations: [{ participant: members[0], amountMinor: '300' }],
};
function expenseSnapshot({ id, ...value }) {
  return {
    ...value,
    __typename: 'ExpenseSnapshot',
    id: `ExpenseSnapshot:${id}:${value.version || '1'}`,
    expenseId: id,
    version: value.version || '1',
  };
}
const view = {
  id: 'ExpenseView:fixture-initial',
  contextVersion: 'fixture-context-v1',
  __typename: 'ExpenseView',
  __isExpenseViewResult: 'ExpenseView',
  totalExpenseMinor: '300',
  viewerShareMinor: '300',
  viewerPaidMinor: '300',
  categories: [
    {
      category: 'GROCERIES',
      totalExpenseMinor: '300',
      viewerShareMinor: '300',
      expenseCount: '1',
    },
  ],
  expenseCount: '1',
  months: [{ month: '2026-10', totalExpenseMinor: '300', expenseCount: '1' }],
  edges: [{ cursor: 'e1', node: expenseSnapshot(expense), source: groups[1] }],
  pageInfo: { hasNextPage: false, endCursor: 'e1' },
};

export function expensePage(after) {
  const ids = after ? [7, 8, 9] : [1, 2, 3, 4, 5, 6];
  return {
    ...view,
    id: after ? 'ExpenseView:fixture-after-e6' : view.id,
    expenseCount: '9',
    totalExpenseMinor: '2700',
    viewerShareMinor: '2700',
    viewerPaidMinor: '2700',
    months: [
      { month: '2026-10', totalExpenseMinor: '2700', expenseCount: '9' },
    ],
    edges: ids.map((i) => ({
      cursor: `e${i}`,
      node: expenseSnapshot({
        ...expense,
        id: `e${i}`,
        description: `Private lunch ${i}`,
      }),
      source: groups[1],
    })),
    pageInfo: { hasNextPage: !after, endCursor: after ? 'e9' : 'e6' },
  };
}
export function responseFor(operation, variables) {
  switch (operation) {
    case 'appearanceQuery':
    case 'profileQuery':
      return {
        currentProfile: {
          __typename: 'Profile',
          id: 'profile-v',
          displayName: 'Private synthetic person',
          appearance: 'LIGHT',
        },
      };
    case 'journeyViewerQuery':
      return {
        viewer: {
          __typename: 'Viewer',
          id: 'v',
          displayName: 'Private synthetic person',
          today: '2026-10-05',
          canCreateGroups: false,
          groups,
        },
      };
    case 'householdAccessQuery':
      return { viewer: { __typename: 'Viewer', groups } };
    case 'householdWorkspaceQuery':
      return {
        householdDashboard: {
          __typename: 'HouseholdDashboard',
          state: 'COMPLETE',
          totals: {
            __typename: 'HouseholdDashboardTotals',
            viewerNetMinor: '8420',
            viewerShareMinor: '300',
            viewerPaidMinor: '8720',
            openBalanceCount: '1',
            activeSpaceCount: '1',
            totalSharedExpenseMinor: '8720',
            totalSharedExpenseCount: '1',
          },
          spaces: [
            {
              ...groups[0],
              groupId: 'H',
              viewerMembership: members[0],
              viewerNetMinor: '8420',
              sharedExpenseCount: '1',
              balances: group('H').balances,
            },
          ],
        },
        ...(variables.recent ? { householdExpenses: view } : {}),
      };
    case 'journeyWorkspaceQuery':
      return {
        viewer: { __typename: 'Viewer', today: '2026-10-05' },
        group: group(variables.id),
        ...(variables.ledger
          ? { groupExpenses: expensePage(variables.after) }
          : {}),
      };
    case 'expensesGroupQuery':
      return { groupExpenses: expensePage(variables.after) };
    case 'journeyGroupQuery':
      return { group: group(variables.id) };
    case 'expenseEditMembersQuery':
      return { group: group(variables.groupId) };
    case 'journeyExpenseQuery':
      return {
        node: {
          ...expense,
          id: variables.id,
          description: `Private lunch ${variables.id.slice(1)}`,
          currency: 'USD',
          note: 'Private fixture note',
          creator: members[0],
          createdAt: '2026-10-01T12:00:00Z',
        },
      };
    default:
      throw new Error(`Unmodeled GraphQL operation: ${operation}`);
  }
}
