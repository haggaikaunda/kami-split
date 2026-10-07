'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { fetchQuery } from 'relay-runtime';
import type { FinancialScope } from '@/lib/relay/environment';
import document, {
  type appearanceQuery,
} from '@/lib/relay/__generated__/appearanceQuery.graphql';
import {
  appearance,
  applyAppearance,
  cacheAppearance,
  cachedAppearance,
  type Appearance,
} from '@/lib/appearance';
const Context = createContext<(actor: string, value: Appearance) => void>(
  () => {},
);
export const useApplyAppearance = () => useContext(Context);
/** The session owns identity; late profile responses must never recolor a new account. */
export function AppearanceProvider({
  scope,
  loading,
  children,
}: {
  scope?: FinancialScope;
  loading: boolean;
  children: React.ReactNode;
}) {
  const accept = useRef<(actor: string, value: Appearance) => void>(() => {});
  useEffect(() => {
    if (loading) return;
    if (!scope) {
      applyAppearance('LIGHT');
      return;
    }
    let live = true,
      revision = 0;
    let value = cachedAppearance(scope.actor);
    const apply = () => applyAppearance(value);
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    accept.current = (actor, next) => {
      if (!live || !scope.isLive() || actor !== scope.actor) return;
      revision++;
      value = next;
      cacheAppearance(actor, value);
      apply();
    };
    let pending: { unsubscribe(): void } | undefined;
    const refresh = () => {
      pending?.unsubscribe();
      const started = ++revision;
      pending = fetchQuery<appearanceQuery>(
        scope.environment,
        document,
        {},
        { fetchPolicy: 'network-only' },
      ).subscribe({
        next(result) {
          if (!live || !scope.isLive() || started !== revision) return;
          if (result.currentProfile?.__typename === 'Profile')
            accept.current(
              scope.actor,
              appearance(result.currentProfile.appearance),
            );
        },
        // Theme reads do not block access; retain the last known preference.
        error() {},
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      accept.current = () => {};
      pending?.unsubscribe();
      media.removeEventListener('change', apply);
      window.removeEventListener('focus', refresh);
      applyAppearance('LIGHT');
    };
  }, [scope, loading]);
  return (
    <Context.Provider value={(actor, value) => accept.current(actor, value)}>
      {children}
    </Context.Provider>
  );
}
