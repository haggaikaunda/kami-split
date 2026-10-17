'use client';
import { createSessionId } from '@/lib/session-id';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, type MouseEventHandler } from 'react';
import type { FinancialScope } from '@/lib/relay/environment';
export type SourceVisit = {
  href: string;
  focus: string;
  scroll: number;
  group?: string;
};
export function ScopedLink({
  scope,
  href,
  id,
  children,
  sourceFocus,
  onClick,
  ...attributes
}: {
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  'aria-label'?: string;
  'aria-current'?: 'page';
  className?: string;
  scope: FinancialScope;
  href: string;
  id: string;
  children: React.ReactNode;
  sourceFocus?: string;
}) {
  const router = useRouter();
  return (
    <Link
      {...attributes}
      onClick={onClick}
      id={id}
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        const token = createSessionId();
        const url = new URL(window.location.href);
        const match = url.pathname.match(/^\/(?:groups|trips)\/([^/]+)$/);
        scope.visits.set(token, {
          href: url.pathname + url.search,
          focus: sourceFocus ?? id,
          scroll: window.scrollY,
          group: match ? decodeURIComponent(match[1]) : undefined,
        });
        // Preserve Next's state while marking the source history entry for browser Back.
        window.history.replaceState(
          { ...window.history.state, financialRestore: token },
          '',
        );
        router.push(`${href}${href.includes('?') ? '&' : '?'}source=${token}`);
      }}
    >
      {children}
    </Link>
  );
}
export function SourceReturn({
  scope,
  household = false,
}: {
  scope: FinancialScope;
  household?: boolean;
}) {
  const params = useSearchParams();
  const trip = usePathname().startsWith('/trips/');
  const token = params.get('source');
  const visit = token ? scope.visits.get(token) : undefined;
  return (
    <Link
      href={
        visit
          ? `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${token}`
          : household
            ? '/household'
            : trip
              ? '/trips'
              : '/groups'
      }
      scroll={false}
      onNavigate={() => {
        if (token) scope.restored.delete(token);
      }}
    >
      {visit
        ? 'Back to source'
        : household
          ? 'Back to Household'
          : trip
            ? 'Back to Trips'
            : 'Back to Groups'}
    </Link>
  );
}
/** Restore only after a fresh authorized source response has rendered. */
export function RestoreSource({
  scope,
  allowed,
}: {
  scope: FinancialScope;
  allowed: readonly string[];
}) {
  const params = useSearchParams();
  const historyToken =
    typeof window !== 'undefined'
      ? (window.history.state?.financialRestore as string | undefined)
      : undefined;
  const historyVisit = historyToken
    ? scope.visits.get(historyToken)
    : undefined;
  // A Back entry can carry an older explicit restore query. Its own visit wins.
  const token =
    historyVisit &&
    historyVisit.href === window.location.pathname + window.location.search
      ? historyToken
      : params.get('restore');
  const ids = allowed.join('\n');
  useEffect(() => {
    if (!token || !scope.isLive() || scope.restored.has(token)) return;
    const visit = scope.visits.get(token);
    const frame = requestAnimationFrame(() => {
      if (!scope.isLive() || scope.restored.has(token)) return;
      scope.restored.add(token);
      const target =
        visit && (!visit.group || allowed.includes(visit.group))
          ? document.getElementById(visit.focus)
          : null;
      const heading = document.querySelector<HTMLElement>(
        '[data-page-heading]',
      );
      (target ?? heading)?.focus({ preventScroll: true });
      window.scrollTo(0, target && visit ? visit.scroll : 0);
    });
    return () => cancelAnimationFrame(frame);
    // Membership IDs are the authorization snapshot, not an unstable array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, token, ids]);
  return null;
}
