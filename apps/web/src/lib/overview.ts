import { checkedSum, positions, type Currency } from './ledger';
import type { Snapshot } from './data/port';

export type DirectObligation = {
  senderId: string;
  recipientId: string;
  amount: number;
  currency: Currency;
};
/** Net only opposite edges between the same two members; never simplify a debt graph. */
export function directObligations(
  snapshot: Snapshot,
  currency: Currency,
): DirectObligation[] {
  // Validate the complete current ledger before deriving a financial display.
  positions(
    snapshot.members.map((member) => member.id),
    snapshot.expenses,
    snapshot.repayments,
    currency,
  );
  const pairs = new Map<
    string,
    { first: string; second: string; amount: number }
  >();
  function add(sender: string, recipient: string, amount: number) {
    if (sender === recipient || amount === 0) return;
    const [first, second] = [sender, recipient].sort();
    const key = JSON.stringify([first, second]);
    const previous = pairs.get(key)?.amount ?? 0;
    pairs.set(key, {
      first,
      second,
      amount: checkedSum([previous, sender === first ? amount : -amount]),
    });
  }
  for (const expense of snapshot.expenses)
    if (!expense.deleted && expense.currency === currency) {
      for (const share of expense.allocations)
        add(share.memberId, expense.payerId, share.amount);
    }
  for (const repayment of snapshot.repayments)
    if (repayment.currency === currency)
      add(repayment.senderId, repayment.recipientId, -repayment.amount);
  return [...pairs.values()]
    .filter((pair) => pair.amount !== 0)
    .map((pair) => ({
      senderId: pair.amount > 0 ? pair.first : pair.second,
      recipientId: pair.amount > 0 ? pair.second : pair.first,
      amount: Math.abs(pair.amount),
      currency,
    }))
    .sort(
      (a, b) =>
        a.senderId.localeCompare(b.senderId) ||
        a.recipientId.localeCompare(b.recipientId),
    );
}
export function overview(
  snapshot: Snapshot,
  currency: Currency = snapshot.household.currency,
) {
  const memberPositions = positions(
    snapshot.members.map((member) => member.id),
    snapshot.expenses,
    snapshot.repayments,
    currency,
  );
  return {
    currency,
    positions: memberPositions,
    obligations: directObligations(snapshot, currency),
    spending: checkedSum(memberPositions.map((position) => position.paid)),
    activeExpenseCount: snapshot.expenses.filter(
      (expense) => !expense.deleted && expense.currency === currency,
    ).length,
    recent: [...snapshot.activity]
      .filter((event) => event.snapshot.currency === currency)
      .sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence)
      .slice(0, 5),
  };
}
