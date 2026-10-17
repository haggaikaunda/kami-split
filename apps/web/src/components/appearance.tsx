'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { fetchQuery } from 'relay-runtime';
import type { FinancialScope } from '@/lib/relay/environment';
import queryDocument, {
  type appearanceQuery,
} from '@/lib/relay/__generated__/appearanceQuery.graphql';
import {
  appearance,
  applyAppearance,
  cacheAppearance,
  cachedAppearance,
  clearAppearanceCache,
  type Appearance,
} from '@/lib/appearance';
const Context = createContext<
  (actor: string, value: Appearance, confirmed?: boolean) => void
>(() => {});
export const useApplyAppearance = () => useContext(Context);
/** The session owns identity; late profile responses must never recolor a new account. */
export function AppearanceProvider({
  scope,
  loading,
  discardAppearance = true,
  children,
}: {
  scope?: FinancialScope;
  loading: boolean;
  discardAppearance?: boolean;
  children: React.ReactNode;
}) {
  const accept = useRef<
    (actor: string, value: Appearance, confirmed?: boolean) => void
  >(() => {});
  // Only a verified scope establishes the actor binding. Keep this small paint
  // value across fail-closed scope replacement, including unavailable storage.
  const retained = useRef<{ actor: string; value: Appearance } | undefined>(
    undefined,
  );
  const ready = useRef<() => void>(() => {});
  const reset = useRef<() => void>(() => {});
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    let live = true,
      revision = 0,
      optimistic = false;
    let value = scope
      ? retained.current?.actor === scope.actor
        ? retained.current.value
        : cachedAppearance(scope.actor)
      : (retained.current?.value ??
        appearance(document.documentElement.dataset.appearance));
    if (scope) retained.current = { actor: scope.actor, value };
    const apply = () => {
      applyAppearance(value);
    };
    reset.current = () => {
      retained.current = undefined;
      value = 'SYSTEM';
      apply();
    };
    apply();
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      // Device detection is optional; applyAppearance has a Light fallback.
    }
    media?.addEventListener('change', apply);
    accept.current = (actor, next, confirmed = true) => {
      if (!live || !scope?.isLive() || actor !== scope.actor) return;
      revision++;
      value = next;
      retained.current = { actor, value };
      optimistic = !confirmed;
      if (confirmed) cacheAppearance(actor, value);
      apply();
    };
    let pending: { unsubscribe(): void } | undefined;
    const refresh = () => {
      if (!scope?.isLive() || optimistic || loadingRef.current) return;
      pending?.unsubscribe();
      const started = ++revision;
      pending = fetchQuery<appearanceQuery>(
        scope.environment,
        queryDocument,
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
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const foreground = () => {
      apply();
      if (document.visibilityState === 'hidden') return;
      clearTimeout(scheduled);
      scheduled = setTimeout(refresh, 0);
    };
    ready.current = foreground;
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      live = false;
      accept.current = () => {};
      pending?.unsubscribe();
      clearTimeout(scheduled);
      ready.current = reset.current = () => {};
      media?.removeEventListener('change', apply);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [scope]);
  useEffect(() => {
    if (loading) return;
    if (!scope) {
      if (!discardAppearance) return;
      clearAppearanceCache();
      reset.current();
    } else ready.current();
  }, [scope, loading, discardAppearance]);
  return (
    <Context.Provider
      value={(actor, value, confirmed) =>
        accept.current(actor, value, confirmed)
      }
    >
      {children}
    </Context.Provider>
  );
}
