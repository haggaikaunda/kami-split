// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, beforeEach } from 'vitest';
import { parsePercentage, percentageShares } from './percentage';
import {
  createInput,
  editPercentage,
  newDraft,
  privateStorageKey,
  readDraft,
  remainingPercentage,
  saveDraft,
  selectSplit,
  validate,
} from './draft';
const members = ['a', 'b', 'c'].map((id) => ({
  id,
  displayName: id,
  canParticipate: true,
}));
const pair = () => ({
  ...newDraft('2026-10-05', 'a', members.slice(0, 2)),
  description: 'Groceries',
  amount: '125.00',
});
beforeEach(() => sessionStorage.clear());
it('matches shared Go vectors and row-order rounding', () => {
  const vectors = JSON.parse(
    readFileSync('../../packages/schema/testdata/percentage.json', 'utf8'),
  ) as { total: string; percentages: number[]; amounts: number[] | null }[];
  for (const v of vectors) {
    const percentages = v.percentages.map((hundredths, i) => ({
      participantId: `${i}`,
      hundredths,
    }));
    if (!v.amounts) {
      expect(() => percentageShares(v.total, percentages)).toThrow();
      continue;
    }
    const amounts = v.amounts.map(String);
    expect(
      percentageShares(v.total, percentages).map((p) => p.amountMinor),
    ).toEqual(amounts);
    expect(
      percentageShares(v.total, [...percentages].reverse()).map(
        (p) => p.amountMinor,
      ),
    ).toEqual(amounts);
  }
});
it('normalizes equivalent text and rejects missing, precision and range', () => {
  for (const value of ['60', '60.0', '60.00'])
    expect(parsePercentage(value)).toBe(6000);
  expect(parsePercentage('0')).toBe(0);
  expect(parsePercentage('100')).toBe(10000);
  for (const value of [
    '',
    ' ',
    '-1',
    '+1',
    '100.01',
    '1.234',
    '1e2',
    '.5',
    '1.',
  ])
    expect(() => parsePercentage(value)).toThrow();
});
it('preserves modes and linking applies only to a valid edit', () => {
  let draft = {
    ...pair(),
    exact: { a: '100', b: '25' },
    ...selectSplit(pair(), 'PERCENTAGE'),
  };
  expect(draft.linkedPercentages).toBe(true);
  draft = { ...draft, percentages: editPercentage(draft, 'a', '62.50') };
  expect(draft.percentages).toEqual({ a: '62.50', b: '37.5' });
  expect(editPercentage(draft, 'a', '')).toEqual({ a: '', b: '37.5' });
  const exact = { ...draft, ...selectSplit(draft, 'EXACT') };
  expect(exact.exact).toEqual({ a: '100', b: '25' });
  expect({ ...exact, ...selectSplit(exact, 'PERCENTAGE') }.percentages).toEqual(
    draft.percentages,
  );
  expect(
    editPercentage(
      { ...draft, participants: ['a', 'c'], linkedPercentages: false },
      'a',
      '70',
    ).c,
  ).toBeUndefined();
});
it('requires exact total, assigns only remaining, retains percentages on amount changes and zero', () => {
  const draft = {
    ...pair(),
    amount: '200',
    split: 'PERCENTAGE' as const,
    participants: ['a', 'b', 'c'],
    percentages: { a: '40', b: '30', c: '15' },
    linkedPercentages: false,
  };
  expect(validate(draft, members).errors.participants).toContain(
    '85% allocated · 15% remaining',
  );
  expect(validate(draft, members).allocations).toEqual([]);
  const balanced = {
    ...draft,
    percentages: { ...draft.percentages, c: remainingPercentage(draft, 'c')! },
  };
  expect(
    validate(balanced, members).allocations.map((p) => p.amountMinor),
  ).toEqual(['8000', '6000', '6000']);
  expect(
    validate({ ...balanced, amount: '100' }, members).allocations.map(
      (p) => p.amountMinor,
    ),
  ).toEqual(['4000', '3000', '3000']);
  const zero = {
    ...balanced,
    amount: '0.01',
    participants: ['a', 'b'],
    percentages: { a: '0', b: '100' },
  };
  expect(createInput(zero, members, 'group', 'key').percentages).toEqual([
    { participantId: 'a', hundredths: 0 },
    { participantId: 'b', hundredths: 10000 },
  ]);
  expect(validate(zero, members).allocations).toEqual([
    { participantId: 'a', amountMinor: '0' },
    { participantId: 'b', amountMinor: '1' },
  ]);
  expect(
    remainingPercentage(
      { ...draft, percentages: { a: '', b: '30', c: '15' } },
      'c',
    ),
  ).toBeUndefined();
});
it('preserves pre-feature pending v1 inputs and percentage attempts through storage', () => {
  const draft = pair();
  const attempt = createInput(
    draft,
    members,
    'old-group',
    '00000000-0000-4000-8000-000000000001',
  );
  const legacy = { ...draft };
  delete legacy.percentages;
  delete legacy.linkedPercentages;
  sessionStorage.setItem(
    privateStorageKey,
    JSON.stringify({
      'old-group': {
        version: 1,
        actor: 'actor',
        group: 'old-group',
        draft: legacy,
        attempt,
      },
    }),
  );
  expect(readDraft('actor', 'old-group')?.attempt).toEqual(attempt);
  const percentage = {
    ...draft,
    ...selectSplit(draft, 'PERCENTAGE'),
    percentages: { a: '60', b: '40' },
  };
  const frozen = createInput(
    percentage,
    members,
    'new-group',
    '00000000-0000-4000-8000-000000000002',
  );
  saveDraft({
    version: 2,
    actor: 'actor',
    group: 'new-group',
    draft: percentage,
    attempt: frozen,
  });
  expect(readDraft('actor', 'new-group')?.attempt).toEqual(frozen);
  expect(readDraft('actor', 'old-group')?.attempt).toEqual(attempt);
  expect(() => readDraft('another', 'new-group')).toThrow();
});
