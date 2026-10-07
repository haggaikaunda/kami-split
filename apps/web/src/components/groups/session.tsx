'use client';
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
            if (actor && !scope) scope = createScope(client, actor);
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
        const subscription = client.auth.onAuthStateChange((event, session) => {
          ticket++;
          update(session?.user.id, event === 'SIGNED_OUT');
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        const before = ticket;
        const { data, error } = await client.auth.getSession();
        if (error) throw new Error('Account access is unavailable.');
        if (ticket === before) update(data.session?.user.id);
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
      scope?.dispose();
    };
  }, []);
  return (
    <Context.Provider value={access}>
      <AppearanceProvider scope={access.scope} loading={access.loading}>
        {children}
      </AppearanceProvider>
    </Context.Provider>
  );
}
