import type {
  Activity,
  ExpenseRecord,
  RepaymentRecord,
  Snapshot,
} from './data/port';

export type HistoryFilters = { search: string; type: string; member: string };
export const activityLabels = {
  created: 'Expense added',
  edited: 'Expense edited',
  deleted: 'Expense deleted',
  repayment: 'Repayment recorded',
} satisfies Record<Activity['kind'], string>;
export function historyMemberName(snapshot: Snapshot, id: string) {
  return (
    snapshot.members.find((member) => member.id === id)?.name ?? 'Former member'
  );
}
export function historyDescription(event: Activity, snapshot: Snapshot) {
  if (event.kind !== 'repayment')
    return (event.snapshot as ExpenseRecord).description;
  const row = event.snapshot as RepaymentRecord;
  return `${historyMemberName(snapshot, row.senderId)} repaid ${historyMemberName(snapshot, row.recipientId)}`;
}
/** Filter immutable event values: later edits/deletions must not rewrite history. */
export function historyEvents(snapshot: Snapshot, filters: HistoryFilters) {
  const search = filters.search.trim().toLocaleLowerCase('en-US');
  return snapshot.activity
    .filter((event) => {
      if (filters.type && filters.type !== 'all' && event.kind !== filters.type)
        return false;
      if (
        search &&
        !historyDescription(event, snapshot)
          .toLocaleLowerCase('en-US')
          .includes(search)
      )
        return false;
      if (filters.member && filters.member !== 'all') {
        if (event.kind === 'repayment') {
          const record = event.snapshot as RepaymentRecord;
          if (
            record.senderId !== filters.member &&
            record.recipientId !== filters.member
          )
            return false;
        } else {
          const record = event.snapshot as ExpenseRecord;
          if (
            record.payerId !== filters.member &&
            !record.participantIds.includes(filters.member)
          )
            return false;
        }
      }
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(b.at) - Date.parse(a.at) ||
        b.sequence - a.sequence ||
        a.id.localeCompare(b.id),
    );
}
export function historyDate(value: string, timestamp = false) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(timestamp
      ? {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short' as const,
        }
      : {}),
  }).format(new Date(timestamp ? value : `${value}T00:00:00Z`));
}
