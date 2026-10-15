import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createOperationDescriptor,
  readInlineData,
  getSingularSelector,
  type GraphQLTaggedNode,
  type Variables,
} from 'relay-runtime';
import { createScope } from './environment';
import householdQuery from './__generated__/expensesHouseholdQuery.graphql';
import groupQuery from './__generated__/expensesGroupQuery.graphql';
import expenseQuery, {
  type journeyExpenseQuery,
} from './__generated__/journeyExpenseQuery.graphql';
import expenseFragment from './__generated__/expenseDetailExpense.graphql';
import combinedQuery from './__generated__/financialIdentityTestQuery.graphql';
import partialQuery from './__generated__/financialIdentityTestPartialQuery.graphql';
import expenseView, {
  type expensesView$key,
} from './__generated__/expensesView.graphql';

const groupId = 'ks1:Group:source';
const expenseId = 'ks1:Expense:expense';
const member = (id: string, displayName = id) => ({
  id: `ks1:Membership:${id}`,
  displayName,
  status: 'ACTIVE',
  role: 'MEMBER',
  canParticipate: true,
});
const alice = member('alice');
const bob = member('bob');
const financial = (version: number) => ({
  groupId,
  version: String(version),
  description: version === 1 ? 'Old groceries' : 'Corrected travel',
  totalMinor: version === 1 ? '10000' : '15000',
  effectiveDate: version === 1 ? '2026-09-01' : '2026-10-02',
  category: version === 1 ? 'GROCERIES' : 'TRANSPORT',
  note: version === 1 ? ' original note ' : 'corrected note',
  currency: 'USD',
  split: 'PERCENTAGE',
  payer: version === 1 ? alice : bob,
  creator: alice,
  createdAt: '2026-09-01T12:00:00.000000Z',
  allocations: [
    {
      participant: alice,
      amountMinor: version === 1 ? '2500' : '0',
      percentageHundredths: version === 1 ? 2500 : 0,
    },
    {
      participant: bob,
      amountMinor: version === 1 ? '7500' : '15000',
      percentageHundredths: version === 1 ? 7500 : 10000,
    },
  ],
});
const snapshot = (version = 1) => ({
  ...financial(version),
  id: `ExpenseSnapshot:${expenseId}:${version}`,
  expenseId,
});
const current = (version = 2) => ({
  ...financial(version),
  __typename: 'Expense',
  id: expenseId,
  canEdit: true,
  editLockReason: null,
});
const view = (version = 1) => ({
  id: `ExpenseView:anchor-${version}`,
  __typename: 'ExpenseView',
  contextVersion: 'current-access-context',
  // Complete totals intentionally exceed this single loaded row.
  totalExpenseMinor: version === 1 ? '30000' : '35000',
  viewerShareMinor: '20000',
  viewerPaidMinor: '10000',
  expenseCount: '3',
  categories: [
    {
      category: 'GROCERIES',
      totalExpenseMinor: '30000',
      viewerShareMinor: '20000',
      expenseCount: '3',
    },
  ],
  months: [{ month: '2026-09', totalExpenseMinor: '30000', expenseCount: '3' }],
  edges: [
    {
      cursor: 'signed-old-boundary',
      node: snapshot(version),
      source: { id: groupId, name: 'Source', currency: 'USD' },
    },
  ],
  pageInfo: { hasNextPage: true, endCursor: 'signed-old-boundary' },
});
const scopes: ReturnType<typeof createScope>[] = [];
function store() {
  const scope = createScope({} as SupabaseClient, 'actor');
  scopes.push(scope);
  return scope.environment;
}
function operation(query: GraphQLTaggedNode, variables: Variables = {}) {
  // Generated ConcreteRequests are the production normalization/read selections.
  return createOperationDescriptor(query as typeof expenseQuery, variables);
}
function readView(ref: expensesView$key) {
  const data = readInlineData(expenseView, ref);
  if (data.__typename !== 'ExpenseView')
    throw new Error('Expected expense view');
  return data;
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.dispose());
  vi.restoreAllMocks();
});

describe('financial snapshot normalization in the account Relay store', () => {
  for (const [name, query, field, variables] of [
    ['Household', householdQuery, 'householdExpenses', {}],
    ['Group', groupQuery, 'groupExpenses', { groupId }],
  ] as const) {
    for (const order of ['detail-after-list', 'list-after-detail'] as const) {
      it(`${name}: ${order} preserves both financial versions and complete totals`, () => {
        const environment = store();
        const list = operation(query, variables);
        const detail = operation(expenseQuery, { id: expenseId });
        const writeList = () =>
          environment.commitPayload(list, { [field]: view() });
        const writeDetail = () =>
          environment.commitPayload(detail, { node: current() });
        if (order === 'detail-after-list') {
          writeList();
          writeDetail();
        } else {
          writeDetail();
          writeList();
        }
        const savedList = environment.lookup(list.fragment).data as Record<
          string,
          expensesView$key
        >;
        const anchored = readView(savedList[field]);
        expect(
          environment.getStore().getSource().get(snapshot(1).id)?.totalMinor,
        ).toBe('10000');
        expect(anchored.edges[0].node).toMatchObject({
          expenseId,
          totalMinor: '10000',
          effectiveDate: '2026-09-01',
          category: 'GROCERIES',
          payer: { id: alice.id },
          allocations: [{ amountMinor: '2500' }, { amountMinor: '7500' }],
        });
        expect(anchored).toMatchObject({
          totalExpenseMinor: '30000',
          expenseCount: '3',
          months: [{ totalExpenseMinor: '30000' }],
          categories: [{ totalExpenseMinor: '30000' }],
        });
        const detailRef = (
          environment.lookup(detail.fragment)
            .data as journeyExpenseQuery['response']
        ).node;
        if (detailRef?.__typename !== 'Expense')
          throw new Error('Expected current Expense');
        const detailSelector = getSingularSelector(
          expenseFragment,
          detailRef.expense,
        );
        if (!detailSelector)
          throw new Error('Expected Expense fragment reference');
        expect(environment.lookup(detailSelector).data).toMatchObject({
          id: expenseId,
          version: '2',
          totalMinor: '15000',
          note: 'corrected note',
          payer: { id: bob.id },
          allocations: [
            { amountMinor: '0', percentageHundredths: 0 },
            { amountMinor: '15000', percentageHundredths: 10000 },
          ],
        });
        // Another refresh/continuation cannot silently publish mixed old rows/new totals.
        writeDetail();
        writeList();
        expect(
          readView(
            (
              environment.lookup(list.fragment).data as Record<
                string,
                expensesView$key
              >
            )[field],
          ).edges[0].node.totalMinor,
        ).toBe('10000');
        expect(
          environment.getStore().getSource().get(expenseId)?.totalMinor,
        ).toBe('15000');
      });
    }
  }

  it('keeps cursor and filter projections separate, including all aggregate fields', () => {
    const environment = store();
    const old = operation(groupQuery, {
      groupId,
      after: 'old-anchor',
      filter: { sort: 'DATE_DESC' },
    });
    const fresh = operation(groupQuery, {
      groupId,
      filter: { sort: 'AMOUNT_ASC' },
    });
    environment.commitPayload(old, { groupExpenses: view() });
    environment.commitPayload(fresh, {
      groupExpenses: {
        ...view(2),
        months: [
          { month: '2026-10', totalExpenseMinor: '35000', expenseCount: '3' },
        ],
        categories: [
          {
            category: 'TRANSPORT',
            totalExpenseMinor: '35000',
            expenseCount: '3',
            viewerShareMinor: '20000',
          },
        ],
      },
    });
    const read = (op: typeof old) =>
      readView(
        (
          environment.lookup(op.fragment).data as {
            groupExpenses: expensesView$key;
          }
        ).groupExpenses,
      );
    expect(read(old)).toMatchObject({
      totalExpenseMinor: '30000',
      months: [{ month: '2026-09' }],
      categories: [{ category: 'GROCERIES' }],
      edges: [{ node: { totalMinor: '10000' } }],
    });
    expect(read(fresh)).toMatchObject({
      totalExpenseMinor: '35000',
      months: [{ month: '2026-10' }],
      categories: [{ category: 'TRANSPORT' }],
      edges: [{ node: { totalMinor: '15000' } }],
    });
  });

  it('publishes a fresh same-argument projection atomically while retained old pages stay anchored', () => {
    const environment = store();
    const first = operation(groupQuery, { groupId });
    const continuation = operation(groupQuery, {
      groupId,
      after: 'old-cursor',
    });
    environment.commitPayload(first, { groupExpenses: view() });
    environment.commitPayload(continuation, {
      groupExpenses: { ...view(), id: 'ExpenseView:old-continuation' },
    });
    const previous = environment.lookup(first.fragment);
    const oldPage = environment.lookup(continuation.fragment);
    const updates: unknown[] = [];
    const subscription = environment.subscribe(previous, (next) => {
      updates.push(
        readView(
          (next.data as { groupExpenses: expensesView$key }).groupExpenses,
        ),
      );
    });
    environment.commitPayload(first, { groupExpenses: view(2) });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      totalExpenseMinor: '35000',
      edges: [{ node: { totalMinor: '15000' } }],
    });
    expect(
      readView(
        (previous.data as { groupExpenses: expensesView$key }).groupExpenses,
      ),
    ).toMatchObject({
      totalExpenseMinor: '30000',
      edges: [{ node: { totalMinor: '10000' } }],
    });
    expect(environment.lookup(continuation.fragment).data).toEqual(
      oldPage.data,
    );
    subscription.dispose();
  });

  it('normalizes overlapping current, legacy-connection, structured and metadata shapes in one response', () => {
    const warning = vi.spyOn(console, 'error');
    const environment = store();
    const combined = operation(combinedQuery, { groupId, expenseId });
    environment.commitPayload(combined, {
      node: current(),
      groupExpenses: view(),
      group: {
        __typename: 'Group',
        id: groupId,
        name: 'Source',
        members: [alice, bob],
        expenses: {
          id: 'ExpenseConnection:anchor-1',
          revision: '4',
          edges: [{ cursor: 'legacy-boundary', snapshot: snapshot() }],
        },
      },
      groupActivity: {
        __typename: 'ActivityConnection',
        edges: [
          {
            node: {
              id: 'ks1:ActivityEvent:event',
              payer: { id: alice.id, displayName: 'alice' },
            },
          },
        ],
      },
      viewer: {
        __typename: 'Viewer',
        id: 'ks1:Viewer:actor',
        displayName: 'actor',
      },
      currentProfile: {
        __typename: 'Profile',
        id: 'ks1:Profile:actor',
        displayName: 'actor',
        appearance: 'LIGHT',
      },
    });
    const result = environment.lookup(combined.fragment);
    expect(result.isMissingData).toBe(false);
    expect(result.data).toMatchObject({
      node: { version: '2', totalMinor: '15000' },
      group: {
        __typename: 'Group',
        expenses: {
          edges: [
            {
              snapshot: {
                version: '1',
                totalMinor: '10000',
                note: ' original note ',
                allocations: [
                  { amountMinor: '2500', percentageHundredths: 2500 },
                  { amountMinor: '7500', percentageHundredths: 7500 },
                ],
              },
            },
          ],
        },
      },
    });
    // A partial refresh at identical arguments must link a new projection,
    // leaving old fragment-owned records intact and new unselected fields missing.
    const partial = operation(partialQuery, { groupId });
    environment.commitPayload(partial, {
      groupExpenses: {
        __typename: 'ExpenseView',
        id: 'ExpenseView:anchor-2',
        edges: [
          {
            node: {
              id: `ExpenseSnapshot:${expenseId}:2`,
              expenseId,
              totalMinor: '15000',
            },
          },
        ],
      },
      group: {
        __typename: 'Group',
        id: groupId,
        expenses: {
          id: 'ExpenseConnection:anchor-2',
          edges: [
            {
              snapshot: {
                id: `ExpenseSnapshot:${expenseId}:2`,
                expenseId,
                totalMinor: '15000',
              },
            },
          ],
        },
      },
    });
    expect(environment.lookup(combined.fragment).isMissingData).toBe(true);
    const source = environment.getStore().getSource();
    expect(source.get('ExpenseView:anchor-1')?.totalExpenseMinor).toBe('30000');
    expect(
      source.get('ExpenseView:anchor-2')?.totalExpenseMinor,
    ).toBeUndefined();
    expect(source.get(`ExpenseSnapshot:${expenseId}:1`)?.note).toBe(
      ' original note ',
    );
    expect(source.get(`ExpenseSnapshot:${expenseId}:2`)?.note).toBeUndefined();
    expect(source.get(groupId)?.__typename).toBe('Group');
    expect(source.get(`GroupSummary:${groupId}`)?.__typename).toBe(
      'GroupSummary',
    );
    expect(source.get(alice.id)?.__typename).toBe('Membership');
    expect(source.get(`ActivityIdentity:${alice.id}`)?.__typename).toBe(
      'ActivityIdentity',
    );
    expect(source.get('ks1:Viewer:actor')?.__typename).toBe('Viewer');
    expect(source.get('ks1:Profile:actor')?.__typename).toBe('Profile');
    expect(warning).not.toHaveBeenCalled();
  });
});
