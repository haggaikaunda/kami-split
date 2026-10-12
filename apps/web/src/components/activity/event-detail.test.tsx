// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { HistoricalDetail, type HistoricalEvent } from './event-detail';
const participant = { id: 'member-a', displayName: 'Alice' };
const snapshot = {
  description: 'Original dinner',
  totalMinor: '101',
  effectiveDate: '2026-10-01',
  category: 'DINING',
  payer: participant,
  split: 'PERCENTAGE',
  note: 'Original recorded note',
  allocations: [
    { participant, amountMinor: '51', percentageHundredths: 5000 },
    {
      participant: { id: 'member-b', displayName: 'Bob' },
      amountMinor: '50',
      percentageHundredths: 5000,
    },
  ],
} as const;
const event = {
  __typename: 'ActivityEvent',
  id: 'created',
  recordId: 'expense',
  kind: 'EXPENSE_CREATED',
  groupId: 'group',
  groupName: 'Original space',
  groupKind: 'ORDINARY',
  isHousehold: false,
  creator: participant,
  payer: participant,
  sender: null,
  recipient: null,
  timestamp: '2026-10-02T12:00:00Z',
  amountMinor: '101',
  currency: 'USD',
  description: snapshot.description,
  effectiveDate: snapshot.effectiveDate,
  note: snapshot.note,
  before: null,
  after: snapshot,
} satisfies HistoricalEvent;
function render(value: HistoricalEvent) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<HistoricalDetail event={value} />);
  return host;
}
function fact(host: Element, name: string) {
  const term = [...host.querySelectorAll('dt')].find(
    (node) => node.textContent === name,
  );
  expect(term, `Missing historical fact: ${name}`).toBeTruthy();
  return term!.nextElementSibling!;
}
it('retains complete created-event facts while showing the unchanged title and total only once', () => {
  const host = render(event);
  expect(host.querySelector('h3')?.textContent).toBe('Original dinner');
  expect(
    [...host.querySelectorAll('dt')].map((node) => node.textContent),
  ).not.toContain('Description');
  expect(host.querySelector('.activity-detail-amount')?.textContent).toContain(
    '$1.01',
  );
  expect(fact(host, 'Date').textContent).toBe('Oct 1, 2026');
  expect(fact(host, 'Payer').textContent).toBe('Alice');
  expect(fact(host, 'Note').textContent).toBe('Original recorded note');
  const shares = [...fact(host, 'Participants').querySelectorAll('li')].map(
    (node) => node.textContent,
  );
  expect(shares).toEqual(['Alice$0.51 USD (50%)', 'Bob$0.50 USD (50%)']);
  expect(host.querySelector('time')?.dateTime).toBe(event.timestamp);
  expect(host.textContent).toContain('Original space');
  expect(host.textContent).toContain(
    'Later expense changes do not rewrite this history.',
  );
});
it('retains labeled old and new description, total, payer and exact percentage allocations for updates', () => {
  const after = {
    ...snapshot,
    description: 'Updated dinner',
    totalMinor: '103',
    payer: { id: 'member-c', displayName: 'Casey' },
    allocations: [
      { participant, amountMinor: '26', percentageHundredths: 2500 },
      {
        participant: { id: 'member-b', displayName: 'Bob' },
        amountMinor: '77',
        percentageHundredths: 7500,
      },
    ],
  };
  const host = render({
    ...event,
    id: 'updated',
    kind: 'EXPENSE_UPDATED',
    before: snapshot,
    after,
    description: after.description,
    amountMinor: after.totalMinor,
  });
  for (const [name, previous, next] of [
    ['Description', 'Original dinner', 'Updated dinner'],
    ['Amount', '$1.01', '$1.03'],
    ['Payer', 'Alice', 'Casey'],
    ['Participants', 'Alice$0.51 USD (50%)', 'Alice$0.26 USD (25%)'],
  ]) {
    const row = fact(host, name);
    expect(row.querySelector('.activity-previous')?.textContent).toContain(
      `Previous${previous}`,
    );
    expect(row.querySelector('.activity-new')?.textContent).toContain(
      `New${next}`,
    );
  }
  expect(fact(host, 'Participants').textContent).toContain('$0.77 USD (75%)');
  expect(fact(host, 'Note').textContent).toContain('Original recorded note');
});
it('keeps repayment sender, recipient, effective date and note separate from recorded time and expense history', () => {
  const host = render({
    ...event,
    kind: 'REPAYMENT_RECORDED',
    after: null,
    payer: null,
    description: '',
    sender: participant,
    recipient: { id: 'member-b', displayName: 'Bob' },
    note: 'Bank transfer',
  });
  expect(host.querySelector('h3')?.textContent).toBe('Paid Bob');
  expect(fact(host, 'Sender').textContent).toBe('Alice');
  expect(fact(host, 'Recipient').textContent).toBe('Bob');
  expect(fact(host, 'Date').textContent).toBe('Oct 1, 2026');
  expect(fact(host, 'Note').textContent).toBe('Bank transfer');
  expect(host.querySelector('time')?.dateTime).toBe('2026-10-02T12:00:00Z');
  expect(host.textContent).toContain('No money is moved by this app.');
});

it('compares original calendar dates before formatting historical previous and new values', () => {
  const changed = render({
    ...event,
    kind: 'EXPENSE_UPDATED',
    before: { ...snapshot, effectiveDate: '2026-12-31' },
    after: { ...snapshot, effectiveDate: '2027-01-01' },
  });
  const row = fact(changed, 'Date');
  expect(row.querySelector('.activity-previous')?.textContent).toBe(
    'PreviousDec 31, 2026',
  );
  expect(row.querySelector('.activity-new')?.textContent).toBe(
    'NewJan 1, 2027',
  );
  expect(
    [...row.querySelectorAll('time')].map((node) => node.dateTime),
  ).toEqual(['2026-12-31', '2027-01-01']);
  const unchanged = fact(
    render({ ...event, kind: 'EXPENSE_UPDATED', before: snapshot }),
    'Date',
  );
  expect(unchanged.textContent).toBe('Oct 1, 2026 (unchanged)');
  expect(unchanged.querySelector('.activity-previous')).toBeNull();
});

it('retains exact offset and fractional precision behind a semantic timestamp disclosure', () => {
  const value = '2026-11-01T01:30:00.123456-07:00';
  const host = render({ ...event, timestamp: value });
  const ordinary =
    host.querySelector('.activity-detail-recorded time') ??
    host.querySelector('time');
  expect(ordinary?.textContent).toBe('Nov 1, 2026, 8:30:00 AM UTC');
  expect(ordinary?.getAttribute('datetime')).toBe(value);
  expect(ordinary?.getAttribute('aria-label')).toContain(value);
  const disclosure = host.querySelector('details')!;
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector('summary')?.textContent).toBe(
    'Exact timestamp',
  );
  expect(disclosure.querySelector('time')?.textContent).toBe(value);
});
