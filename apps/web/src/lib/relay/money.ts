/** Canonical signed int64 wire cents. Never coerce aggregate amounts to Number. */
export function minor(value: string): bigint {
  if (!/^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value) || value.length > 20)
    throw new Error('Invalid monetary amount');
  const amount = BigInt(value);
  if (amount < -9223372036854775808n || amount > 9223372036854775807n)
    throw new Error('Monetary amount is out of range');
  return amount;
}
export function money(value: string): string {
  const amount = minor(value);
  const absolute = amount < 0n ? -amount : amount;
  const dollars = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0n ? '-' : ''}$${dollars}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function parseAmount(text: string, allowZero = false): string {
  const value = text.replace(/^ +| +$/g, '');
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value) || value.length > 32)
    throw new Error('Enter dollars with up to two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents < (allowZero ? 0n : 1n) || cents > 999999999n)
    throw new Error(`Enter ${allowZero ? '$0.00' : '$0.01'} to $9,999,999.99.`);
  return cents.toString();
}
export function equalShares(total: string, participants: readonly string[]) {
  if (!participants.length) return [];
  const sorted = [...participants].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const amount = minor(total),
    count = BigInt(sorted.length);
  return sorted.map((participantId, index) => ({
    participantId,
    amountMinor: (
      amount / count +
      (BigInt(index) < amount % count ? 1n : 0n)
    ).toString(),
  }));
}
