'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
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
}: {
  scope: FinancialScope;
  href: string;
  id: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      id={id}
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        const token = crypto.randomUUID();
        const url = new URL(window.location.href);
        const match = url.pathname.match(/^\/groups\/([^/]+)$/);
        scope.visits.set(token, {
          href: url.pathname + url.search,
          focus: id,
          scroll: window.scrollY,
          group: match ? decodeURIComponent(match[1]) : undefined,
        });
        router.push(`${href}?source=${token}`);
      }}
    >
      {children}
    </Link>
  );
}
export function SourceReturn({ scope }: { scope: FinancialScope }) {
  const params = useSearchParams();
  const token = params.get('source');
  const visit = token ? scope.visits.get(token) : undefined;
  return (
    <Link
      href={
        visit
          ? `${visit.href}${visit.href.includes('?') ? '&' : '?'}restore=${token}`
          : '/groups'
      }
      scroll={false}
      onNavigate={() => {
        if (token) scope.restored.delete(token);
      }}
    >
      {visit ? 'Back to source' : 'Back to Groups'}
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
  const token = params.get('restore');
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
