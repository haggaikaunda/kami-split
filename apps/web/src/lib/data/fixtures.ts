import { equalSplit } from '../ledger';
import type { ExpenseRecord, Fixture, Snapshot, Trip } from './port';

const sampleRows: readonly (readonly [
  string,
  number,
  string,
  string,
  string,
  string | null,
])[] = [
  ['Weekly groceries', 8436, 'member-m', '2026-09-19', 'Groceries', null],
  ['Dinner at Juniper', 6800, 'member-k', '2026-09-18', 'Dining', null],
  ['Internet · September', 6800, 'member-m', '2026-09-16', 'Home', null],
  ['Household essentials', 5000, 'member-m', '2026-09-12', 'Home', null],
  [
    'Kīhei beach condo',
    64000,
    'member-m',
    '2026-09-05',
    'Accommodation',
    'maui',
  ],
  ['Flights to Kahului', 64000, 'member-k', '2026-09-05', 'Transport', 'maui'],
  ['Poke bowls in Pāʻia', 8620, 'member-k', '2026-09-06', 'Dining', 'maui'],
  [
    'Molokini snorkel outing',
    14000,
    'member-m',
    '2026-09-07',
    'Activities',
    'maui',
  ],
  ['Hāna picnic supplies', 4210, 'member-k', '2026-09-08', 'Groceries', 'maui'],
  ['Road to Hāna gas', 5380, 'member-k', '2026-09-09', 'Transport', 'maui'],
  [
    'Ride to Kahului Airport',
    4210,
    'member-m',
    '2026-09-13',
    'Transport',
    'maui',
  ],
  ['Lakeside cabin', 42000, 'member-k', '2026-08-14', 'Accommodation', 'tahoe'],
  ['Car rental', 34000, 'member-m', '2026-08-14', 'Transport', 'tahoe'],
  ['Dinner at the lake', 8000, 'member-m', '2026-08-16', 'Dining', 'tahoe'],
  ['Summer groceries', 12600, 'member-k', '2026-07-09', 'Groceries', null],
  ['Summer groceries', 12600, 'member-m', '2026-07-23', 'Groceries', null],
  ['Spring household supplies', 18000, 'member-k', '2026-04-05', 'Home', null],
  ['Spring household supplies', 18000, 'member-m', '2026-04-18', 'Home', null],
  ['Winter household supplies', 15000, 'member-k', '2026-01-06', 'Home', null],
  ['Winter household supplies', 15000, 'member-m', '2026-01-16', 'Home', null],
  [
    'Shared expenses · December',
    48000,
    'member-k',
    '2025-12-02',
    'Other',
    null,
  ],
  [
    'Shared expenses · November',
    48000,
    'member-m',
    '2025-11-02',
    'Other',
    null,
  ],
  ['Shared expenses · June', 25000, 'member-k', '2024-06-02', 'Other', null],
  ['Shared expenses · June', 25000, 'member-m', '2024-06-12', 'Other', null],
];
const trips: Trip[] = [
  {
    id: 'maui',
    name: 'A week in Maui',
    destination: 'Kīhei & the Road to Hāna',
    start: '2026-09-05',
    end: '2026-09-13',
    cover: 'maui',
  },
  {
    id: 'tahoe',
    name: 'Lake Tahoe escape',
    destination: 'California',
    start: '2026-08-14',
    end: '2026-08-17',
    cover: 'tahoe',
  },
  {
    id: 'porto',
    name: 'Porto, here we come',
    destination: 'Portugal',
    start: '2027-05-12',
    end: '2027-05-18',
    cover: null,
  },
];
export function fixture(name: Fixture, today: string): Snapshot {
  const members: Snapshot['members'] = [
    { id: 'member-k', name: 'Kaunda', role: 'owner', status: 'active' },
    { id: 'member-m', name: 'Mizenin', role: 'member', status: 'active' },
  ];
  if (name === 'three-members')
    members.push({
      id: 'member-r',
      name: 'River',
      role: 'member',
      status: 'active',
    });
  const expenses: ExpenseRecord[] =
    name === 'empty'
      ? []
      : sampleRows.map(
          (
            [description, amount, payerId, effectiveDate, category, tripId],
            i,
          ) => {
            const participantIds =
              name === 'three-members'
                ? members.map((member) => member.id)
                : ['member-k', 'member-m'];
            return {
              id: String(i < 3 ? i + 1 : i === 3 ? 5 : 100 + i - 4),
              description,
              amount,
              payerId,
              effectiveDate,
              category,
              tripId,
              participantIds,
              allocations: equalSplit(amount, participantIds),
              split: 'equal',
              currency: 'USD',
              note:
                i === 0
                  ? 'Groceries for the week'
                  : i === 1
                    ? 'Friday dinner'
                    : '',
              creatorId: payerId,
              createdAt: `${effectiveDate}T12:00:00.000Z`,
              updatedAt: `${effectiveDate}T12:00:00.000Z`,
              version: 1,
            };
          },
        );
  const repayments: Snapshot['repayments'] =
    name === 'empty'
      ? []
      : [
          {
            id: 'repayment-4',
            amount: 2500,
            currency: 'USD',
            senderId: 'member-k',
            recipientId: 'member-m',
            effectiveDate: '2026-09-14',
            note: 'Last week’s balance',
            creatorId: 'member-k',
            createdAt: '2026-09-14T12:00:00.000Z',
          },
        ];
  const revisions = expenses.map((row) => ({
    id: `revision-${row.id}-1`,
    expenseId: row.id,
    version: 1,
    actorId: row.creatorId,
    at: row.createdAt,
    reason: '',
    snapshot: structuredClone(row),
  }));
  const activity: Snapshot['activity'] = [
    ...expenses.map((row, i) => ({
      id: `event-${i + 1}`,
      sequence: i + 1,
      at: row.createdAt,
      actorId: row.creatorId,
      kind: 'created' as const,
      recordId: row.id,
      revisionId: `revision-${row.id}-1`,
      snapshot: structuredClone(row),
    })),
    ...repayments.map((row, i) => ({
      id: `event-${expenses.length + i + 1}`,
      sequence: expenses.length + i + 1,
      at: row.createdAt,
      actorId: row.creatorId,
      kind: 'repayment' as const,
      recordId: row.id,
      snapshot: structuredClone(row),
    })),
  ];
  return {
    household: { id: 'household-demo', name: 'Our household', currency: 'USD' },
    actorId: 'member-k',
    today,
    members,
    expenses,
    repayments,
    trips: structuredClone(trips),
    revisions,
    activity,
    generation: 0,
  };
}
