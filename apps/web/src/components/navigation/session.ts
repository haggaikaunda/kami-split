export type SourceDescriptor = Readonly<{
  visitId: string;
  entryId: string;
  href: string;
  scroll: { x: number; y: number };
  focusId: string;
  adjacent: boolean;
}>;
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type DraftValue = Record<string, JsonValue>;
export type SessionDraft<T extends DraftValue = DraftValue> = {
  id: string;
  label: string;
  href: string;
  values: T;
  operationId: string;
  pending: boolean;
  source?: SourceDescriptor;
};
/** URL state owns filters/tabs/chart selections; this stores only return metadata. */
export function sourceDescriptor(
  href: string,
  entryId: string,
  focusId: string,
  scroll: { x: number; y: number },
  visitId: string,
): SourceDescriptor {
  if (!href.startsWith('/') || href.startsWith('//'))
    throw new Error('Source must be an in-app path');
  return {
    href,
    entryId,
    focusId,
    scroll: { ...scroll },
    visitId,
    adjacent: true,
  };
}
export function expenseHref(id: string, visitId?: string): string {
  return `/expenses/${encodeURIComponent(id)}${visitId ? `?visit=${encodeURIComponent(visitId)}` : ''}`;
}
export function fullPageHref(href: string): string {
  const url = new URL(href, 'https://kami.invalid');
  url.searchParams.set('view', 'full');
  return url.pathname + url.search;
}
export function presentation(
  contextual: boolean,
  width: number,
  full: boolean,
): 'panel' | 'page' {
  return contextual && width > 760 && !full ? 'panel' : 'page';
}
