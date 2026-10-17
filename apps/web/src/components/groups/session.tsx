'use client';
import { RelayEnvironmentProvider } from 'react-relay';
import { AppearanceProvider } from '@/components/appearance';
import { createContext, useContext, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadClient } from '@/lib/onboarding/client';
import { clearFinancialStorage } from '@/lib/relay/draft';
import { createScope, type FinancialScope } from '@/lib/relay/environment';
type Access = {
  loading: boolean;
  client?: SupabaseClient;
  scope?: FinancialScope;
  error?: string;
};
const Context = createContext<Access>({ loading: true });
export const useFinancialSession = () => useContext(Context);
/** Lives above navigation, so logout on the account page also clears financial drafts. */
export function FinancialSession({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<Access>({ loading: true });
  useEffect(() => {
    let active = true,
      ticket = 0;
    let pendingPurge = false;
    let scope: FinancialScope | undefined;
    let unsubscribe: (() => void) | undefined;
    let stopEvents: (() => void) | undefined;
    let foregroundTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    void loadClient()
      .then(async (client) => {
        if (!active) return;
        const update = (actor: string | undefined, signedOut = false) => {
          if (!active) return;
          // Invalidate memory before touching storage: storage can throw during logout.
          if (signedOut || !actor || (scope && scope.actor !== actor))
            pendingPurge = true;
          const changed = signedOut || scope?.actor !== actor;
          if (changed) {
            scope?.dispose();
            scope = undefined;
          }
          try {
            const previous = sessionStorage.getItem('kami-financial-subject');
            if (previous && previous !== actor) pendingPurge = true;
            if (pendingPurge) {
              clearFinancialStorage();
              pendingPurge = false;
            }
            if (actor) sessionStorage.setItem('kami-financial-subject', actor);
            else sessionStorage.removeItem('kami-financial-subject');
            if (actor && !scope)
              scope = createScope(client, actor, () => {
                ticket++;
                scope = undefined;
                setAccess({
                  loading: false,
                  client,
                  error:
                    'Financial access is unavailable. Reload to check current access.',
                });
              });
            setAccess({ loading: false, client, scope });
          } catch {
            scope?.dispose();
            scope = undefined;
            setAccess({
              loading: false,
              error:
                'Private storage is unavailable. Financial access is blocked. Restore browser storage access and reload.',
            });
          }
        };
        const verify = async () => {
          const before = ++ticket;
          setAccess((current) => ({ ...current, loading: true }));
          try {
            const { data, error } = await client.auth.getUser();
            if (!active || before !== ticket) return;
            if (error && error.name !== 'AuthSessionMissingError') {
              update(undefined);
              setAccess({
                loading: false,
                client,
                error:
                  'Account verification failed. Sign in or reload to try again.',
              });
              return;
            }
            update(data.user?.id);
            clearTimeout(expiryTimer);
            if (data.user) {
              const snapshot = await client.auth.getSession();
              if (!active || before !== ticket) return;
              const expires = snapshot.data.session?.expires_at;
              if (expires)
                expiryTimer = setTimeout(
                  () => {
                    clearTimeout(foregroundTimer);
                    scope?.dispose();
                    scope = undefined;
                    void verify();
                  },
                  Math.max(0, expires * 1000 - Date.now()),
                );
            }
          } catch {
            if (!active || before !== ticket) return;
            update(undefined);
            setAccess({
              loading: false,
              client,
              error:
                'Account verification failed. Sign in or reload to try again.',
            });
          }
        };
        const subscription = client.auth.onAuthStateChange((event, session) => {
          ticket++;
          if (event === 'SIGNED_OUT' || !session) {
            clearTimeout(foregroundTimer);
            clearTimeout(expiryTimer);
            update(undefined, true);
          } else {
            setAccess((current) => ({ ...current, loading: true }));
            // Do not await another SDK call inside its locked auth callback.
            clearTimeout(foregroundTimer);
            foregroundTimer = setTimeout(() => {
              if (active) void verify();
            }, 0);
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        const hide = () => {
          clearTimeout(foregroundTimer);
          ticket++;
          setAccess((current) => ({ ...current, loading: true }));
        };
        const foreground = () => {
          if (document.visibilityState === 'hidden') hide();
          else {
            // Reject responses begun before this invalidation, including the
            // interval before the coalesced replacement verification starts.
            ticket++;
            // One verification for a synchronous pageshow/popstate/visibility burst.
            // Hide private content immediately, even before the scheduled read.
            setAccess((current) => ({ ...current, loading: true }));
            clearTimeout(foregroundTimer);
            foregroundTimer = setTimeout(() => void verify(), 0);
          }
        };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', foreground);
        window.addEventListener('popstate', foreground);
        document.addEventListener('visibilitychange', foreground);
        stopEvents = () => {
          window.removeEventListener('pagehide', hide);
          window.removeEventListener('pageshow', foreground);
          window.removeEventListener('popstate', foreground);
          document.removeEventListener('visibilitychange', foreground);
        };
        await verify();
      })
      .catch(() => {
        if (active) {
          scope?.dispose();
          setAccess({
            loading: false,
            error: 'Account access is unavailable. Refresh to try again.',
          });
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
      stopEvents?.();
      clearTimeout(expiryTimer);
      clearTimeout(foregroundTimer);
      scope?.dispose();
    };
  }, []);
  return (
    <Context.Provider value={access}>
      <AppearanceProvider scope={access.scope} loading={access.loading}>
        {access.scope ? (
          <RelayEnvironmentProvider
            key={access.scope.id}
            environment={access.scope.environment}
          >
            {children}
          </RelayEnvironmentProvider>
        ) : (
          children
        )}
      </AppearanceProvider>
    </Context.Provider>
  );
}
