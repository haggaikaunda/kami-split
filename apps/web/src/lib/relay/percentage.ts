/** Exact decimal text to integer hundredths of a percent; blank never means zero. */
export function parsePercentage(text: string): number {
  const value = text.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value) || value.length > 32)
    throw new Error('Enter 0–100% with up to two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hundredths > 10000n)
    throw new Error('Enter a percentage from 0% to 100%.');
  return Number(hundredths);
}
export function percentageText(hundredths: number): string {
  const value = BigInt(hundredths);
  return `${value / 100n}${value % 100n ? `.${(value % 100n).toString().padStart(2, '0').replace(/0$/, '')}` : ''}`;
}
export type Percentage = { participantId: string; hundredths: number };
/** Authoritative server bounds and largest-remainder rule mirrored only for preview. */
export function percentageShares(
  total: string,
  percentages: readonly Percentage[],
) {
  const amount = BigInt(total);
  if (
    amount < 1n ||
    amount > 999999999n ||
    !percentages.length ||
    new Set(percentages.map((p) => p.participantId)).size !==
      percentages.length ||
    percentages.some(
      (p) =>
        !Number.isInteger(p.hundredths) ||
        p.hundredths < 0 ||
        p.hundredths > 10000,
    ) ||
    percentages.reduce((sum, p) => sum + BigInt(p.hundredths), 0n) !== 10000n
  )
    throw new Error('Reconcile percentages to exactly 100% before previewing.');
  const shares = [...percentages]
    .sort((a, b) =>
      a.participantId < b.participantId
        ? -1
        : a.participantId > b.participantId
          ? 1
          : 0,
    )
    .map((p) => {
      const product = amount * BigInt(p.hundredths);
      return { ...p, amount: product / 10000n, remainder: product % 10000n };
    });
  const remaining = amount - shares.reduce((sum, p) => sum + p.amount, 0n);
  const ranked = shares
    .filter((p) => p.hundredths > 0)
    .sort((a, b) =>
      a.remainder !== b.remainder
        ? a.remainder > b.remainder
          ? -1
          : 1
        : a.participantId < b.participantId
          ? -1
          : 1,
    );
  for (let i = 0n; i < remaining; i++) ranked[Number(i)].amount++;
  return shares.map((p) => ({
    participantId: p.participantId,
    amountMinor: p.amount.toString(),
  }));
}
