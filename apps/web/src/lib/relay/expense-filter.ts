import type { expensesGroupQuery } from './__generated__/expensesGroupQuery.graphql';
export const filterKeys = [
  'groupId',
  'category',
  'memberId',
  'from',
  'to',
] as const;
export function expenseFilterText(params: Pick<URLSearchParams, 'get'>) {
  return new URLSearchParams(
    filterKeys.flatMap((key) =>
      params.get(key) ? [[key, params.get(key)!]] : [],
    ),
  ).toString();
}
export function expenseFilter(
  text: string,
): NonNullable<expensesGroupQuery['variables']['filter']> {
  const params = new URLSearchParams(text);
  return Object.fromEntries(
    filterKeys.map((key) => [key, params.get(key) || null]),
  );
}
