'use client';
import { createSessionId } from '@/lib/session-id';
import { groupRouteId } from '@/lib/relay/discovery';
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
        scope.visits.set(token, {
          href: url.pathname + url.search,
          focus: sourceFocus ?? id,
          scroll: window.scrollY,
          group: groupRouteId(url.pathname),
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
  authorizedGroups,
  fallbackLabel,
  label,
  authorized = true,
}: {
  scope: FinancialScope;
  household?: boolean;
  authorizedGroups?: readonly { id: string; name: string }[];
  fallbackLabel?: string;
  /** A source-specific visible return label; authorization and href ownership stay here. */
  label?: string;
  /** The owning read can deny a saved origin after fresh access validation. */
  authorized?: boolean;
}) {
  const params = useSearchParams();
  const trip = usePathname().startsWith('/trips/');
  const token = params.get('source');
  const visit = token && scope.isLive() ? scope.visits.get(token) : undefined;
  const origin = visit
    ? new URL(visit.href, 'https://workspace.invalid')
    : undefined;
  const groupId =
    authorizedGroups !== undefined
      ? groupRouteId(origin?.pathname ?? '')
      : visit?.group;
  const group = groupId
    ? authorizedGroups?.find((group) => group.id === groupId)
    : undefined;
  const valid =
    authorized &&
    visit &&
    (!groupId || authorizedGroups === undefined || group);
  const destination = valid ? origin : undefined;
  if (destination && token) destination.searchParams.set('restore', token);
  return (
    <Link
      href={
        destination
          ? destination.pathname + destination.search
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
      {label ??
        (destination
          ? sourceReturnLabel(destination.pathname, group?.name)
          : (fallbackLabel ??
            (household
              ? 'Back to Household'
              : trip
                ? 'Back to Trips'
                : 'Back to Groups')))}
    </Link>
  );
}
/** These names describe known routes, never text supplied through a query string. */
function sourceReturnLabel(pathname: string, groupName?: string) {
  if (pathname.startsWith('/household')) return 'Back to Household';
  if (pathname === '/personal' || pathname.startsWith('/personal/'))
    return 'Back to Personal';
  if (groupName) return `Back to ${groupName}`;
  if (pathname === '/groups/activity') return 'Back to Activity';
  if (pathname === '/groups/new') return 'Back to Create group';
  if (pathname === '/trips/new') return 'Back to Create trip';
  if (pathname === '/account') return 'Back to Profile';
  return pathname.startsWith('/trips') ? 'Back to Trips' : 'Back to Groups';
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
