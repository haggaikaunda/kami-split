import { describe, expect, it } from 'vitest';
import { equalShares, minor, money, parseAmount } from './money';

describe('independent approved monetary contract', () => {
  it('preserves aggregate cents beyond JavaScript safe integers and both int64 endpoints', () => {
    expect(money('9007199254740993')).toBe('$90,071,992,547,409.93');
    expect(money('9223372036854775807')).toBe('$92,233,720,368,547,758.07');
    expect(money('-9223372036854775808')).toBe('-$92,233,720,368,547,758.08');
    expect(money('0')).toBe('$0.00');
  });
  it.each([
    '01',
    '-0',
    '+1',
    ' 1',
    '1.0',
    '1e2',
    '9223372036854775808',
    '-9223372036854775809',
  ])('rejects noncanonical/out-of-range wire cents %s', (value) => {
    expect(() => minor(value)).toThrow();
  });
  it('accepts expense boundaries and explicit zero exact shares without rounding', () => {
    expect(parseAmount('0.01')).toBe('1');
    expect(parseAmount('9999999.99')).toBe('999999999');
    expect(parseAmount('0', true)).toBe('0');
    for (const amount of ['0', '10000000', '0.001', '1e2', '-1'])
      expect(() => parseAmount(amount)).toThrow();
  });
  it('allocates the extra cent in stable membership order and retains zero-share participants', () => {
    const first = 'ks1:Membership:00000000-0000-4000-8000-000000000001';
    const second = 'ks1:Membership:00000000-0000-4000-8000-000000000002';
    expect(equalShares('1', [second, first])).toEqual([
      { participantId: first, amountMinor: '1' },
      { participantId: second, amountMinor: '0' },
    ]);
    expect(equalShares('101', [second, first])).toEqual([
      { participantId: first, amountMinor: '51' },
      { participantId: second, amountMinor: '50' },
    ]);
  });
});
