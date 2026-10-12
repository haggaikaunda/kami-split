import type { expensesGroupQuery } from './__generated__/expensesGroupQuery.graphql';
export const filterKeys = [
  'groupId',
  'category',
  'memberId',
  'categories',
  'memberIds',
  'paidByIds',
  'from',
  'to',
  'sort',
] as const;
export const multiFilterKeys = [
  'categories',
  'memberIds',
  'paidByIds',
] as const;
type Params = Pick<URLSearchParams, 'get' | 'getAll'>;
export function filterValues(params: Params, key: string): string[] {
  const legacy =
    key === 'categories' ? 'category' : key === 'memberIds' ? 'memberId' : null;
  return [
    ...new Set(
      [...params.getAll(key), ...(legacy ? params.getAll(legacy) : [])].filter(
        Boolean,
      ),
    ),
  ].sort();
}
export function expenseFilterText(params: Params) {
  const result = new URLSearchParams();
  for (const key of ['groupId', 'from', 'to', 'sort']) {
    const value = params.get(key);
    if (value && !(key === 'sort' && value === 'DATE_DESC'))
      result.set(key, value);
  }
  for (const key of multiFilterKeys)
    for (const value of filterValues(params, key)) result.append(key, value);
  return result.toString();
}
export function expenseFilter(
  text: string,
): NonNullable<expensesGroupQuery['variables']['filter']> {
  const params = new URLSearchParams(
    expenseFilterText(new URLSearchParams(text)),
  );
  return {
    groupId: params.get('groupId'),
    from: params.get('from'),
    to: params.get('to'),
    categories: params.getAll('categories') as NonNullable<
      expensesGroupQuery['variables']['filter']
    >['categories'],
    memberIds: params.getAll('memberIds'),
    paidByIds: params.getAll('paidByIds'),
    sort: (params.get('sort') || 'DATE_DESC') as NonNullable<
      expensesGroupQuery['variables']['filter']
    >['sort'],
  };
}
export function datePreset(today: string, preset: string) {
  const day = new Date(`${today}T00:00:00Z`);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'last7') {
    day.setUTCDate(day.getUTCDate() - 6);
    return { from: date(day), to: today };
  }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'previousMonth') {
    day.setUTCDate(0);
    return { from: `${date(day).slice(0, 7)}-01`, to: date(day) };
  }
  return { from: '', to: '' };
}
