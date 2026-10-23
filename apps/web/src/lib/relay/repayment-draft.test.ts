// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  amountText,
  readRepayment,
  saveRepayment,
  validateRepayment,
} from './repayment-draft';
import { clearFinancialStorage, repaymentStorageKey } from './draft';
const members = [
  { id: 'a', displayName: 'A', canParticipate: true },
  { id: 'b', displayName: 'B', canParticipate: true },
];
const draft = {
  sender: 'a',
  recipient: 'b',
  amount: '10.01',
  date: '2026-10-04',
  note: '  actual transfer  ',
};
beforeEach(() => sessionStorage.clear());
it('validates exact cents and permits partial, over and unmatched actual transfers', () => {
  for (const amount of ['0.01', '5.00', '9999999.99'])
    expect(validateRepayment({ ...draft, amount }, members).errors).toEqual({});
  expect(validateRepayment(draft, members).amount).toBe('1001');
  expect(amountText('9007199254740993')).toBe('90071992547409.93');
});
it('rejects wrong members, same member, invalid dates, Unicode and out-of-contract amounts', () => {
  expect(
    validateRepayment(
      {
        ...draft,
        sender: 'other-group',
        recipient: 'other-group',
        date: '2026-02-30',
        note: '\0',
        amount: '10000000.00',
      },
      members,
    ).errors,
  ).toEqual(
    expect.objectContaining({
      sender: expect.any(String),
      recipient: expect.any(String),
      date: expect.any(String),
      note: expect.any(String),
      amount: expect.any(String),
    }),
  );
  expect(
    validateRepayment({ ...draft, recipient: 'a' }, members).errors.recipient,
  ).toBeTruthy();
  expect(
    validateRepayment({ ...draft, date: '2028-02-29', note: '😀' }, members)
      .errors,
  ).toEqual({});
});
it('retains actor/group scope and frozen input, blocks malformed storage and clears on logout', () => {
  const attempt = {
    groupId: 'G',
    key: crypto.randomUUID(),
    senderId: 'a',
    recipientId: 'b',
    amountMinor: '1001',
    currency: 'USD' as const,
    effectiveDate: draft.date,
    note: draft.note,
  };
  saveRepayment({ version: 1, actor: 'actor-a', group: 'G', draft, attempt });
  expect(readRepayment('actor-a', 'G')?.attempt).toEqual(attempt);
  expect(readRepayment('actor-a', 'T')).toBeUndefined();
  expect(() => readRepayment('actor-c', 'G')).toThrow();
  sessionStorage.setItem(repaymentStorageKey, '{"G":{"attempt":{}}}');
  expect(() => readRepayment('actor-a', 'G')).toThrow();
  clearFinancialStorage();
  expect(sessionStorage.getItem(repaymentStorageKey)).toBeNull();
});

it('clears every actor enrollment recovery identity without erasing unrelated presentation storage', () => {
  sessionStorage.setItem(
    'kami-personal-enrollment:actor-a',
    'opaque-attempt-a',
  );
  sessionStorage.setItem(
    'kami-personal-enrollment:actor-b',
    'opaque-attempt-b',
  );
  sessionStorage.setItem(
    'kami-personal-enrollment:actor-a:manage:plan',
    'opaque-plan',
  );
  sessionStorage.setItem(
    'kami-personal-enrollment:actor-a:manage:management',
    'opaque-management',
  );
  sessionStorage.setItem('unrelated-presentation', 'retained');
  clearFinancialStorage();
  expect(sessionStorage.getItem('kami-personal-enrollment:actor-a')).toBeNull();
  expect(sessionStorage.getItem('kami-personal-enrollment:actor-b')).toBeNull();
  expect(
    sessionStorage.getItem('kami-personal-enrollment:actor-a:manage:plan'),
  ).toBeNull();
  expect(
    sessionStorage.getItem(
      'kami-personal-enrollment:actor-a:manage:management',
    ),
  ).toBeNull();
  expect(sessionStorage.getItem('unrelated-presentation')).toBe('retained');
});
