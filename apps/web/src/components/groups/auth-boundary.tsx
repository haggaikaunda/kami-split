'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { signInHref } from '@/lib/auth/routes';
import { useFinancialSession } from './session';

/** Suppresses protected children during resolution, logout, and history restoration. */
export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const access = useFinancialSession();
  const pathname = usePathname();
  const router = useRouter();
  const content = useRef<HTMLDivElement>(null);
  const publicPage = pathname === '/sign-in';
  useEffect(() => {
    if (!publicPage && !access.loading && !access.scope) {
      router.replace(
        signInHref(window.location.pathname + window.location.search) +
          (access.error ? '&auth=unavailable' : ''),
      );
      router.refresh();
    }
  }, [publicPage, access.loading, access.scope, access.error, router]);
  useEffect(() => {
    // Hide synchronously before a browser captures a BFCache document snapshot.
    const hide = () => {
      if (content.current) content.current.hidden = true;
    };
    window.addEventListener('pagehide', hide);
    const visible = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  if (publicPage) return children;
  if (access.loading)
    return (
      <main>
        <p role="status">Checking account access…</p>
      </main>
    );
  if (!access.scope)
    return (
      <main>
        <p role={access.error ? 'alert' : 'status'}>
          {access.error ?? 'Opening sign in…'}
        </p>
        <a href={signInHref(pathname)}>Sign in</a>
        {access.error && (
          <button
            onClick={() => window.location.reload()}
            data-ui="form-button"
          >
            Retry account access
          </button>
        )}
      </main>
    );
  return <div ref={content}>{children}</div>;
}
