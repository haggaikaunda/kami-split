'use client';
import { useExpenseNavigation, useRouteContext } from '../navigation/provider';
export function useSpendingNavigation(route: string) {
  const { searchParams, isActive } = useRouteContext(route);
  const { openContext, replaceQuery, returnToSource } = useExpenseNavigation();
  const change = (values: Record<string, string>) => {
    if (!isActive) return;
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    replaceQuery(`${route}${next.size ? `?${next}` : ''}`);
  };
  const open = (bucket: string, triggerId: string) => {
    if (!isActive) return;
    const next = new URLSearchParams(window.location.search);
    next.set('bucket', bucket);
    openContext(`${route}?${next}`, triggerId);
  };
  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('bucket');
    next.delete('visit');
    returnToSource(
      searchParams.get('visit'),
      `${route}${next.size ? `?${next}` : ''}`,
    );
  };
  return { searchParams, isActive, change, open, close };
}
