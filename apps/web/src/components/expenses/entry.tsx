'use client';
import {
  createContext,
  useContext,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { FinancialScope } from '@/lib/relay/environment';

type Entry = { source: string; focus: string };
type Handoff = {
  register(owner: object, receive: (entry: Entry) => void): () => void;
  activate(event: MouseEvent<HTMLAnchorElement>, source: string): void;
};
const Context = createContext<Handoff | undefined>(undefined);

/** Coordinates shared chrome departures and its mounted ledger. Native navigation
 * still owns the link; the ledger records its return geometry before activation. An empty source
 * records a Profile/global departure without selecting an expense source. */
export function ExpenseEntryProvider({
  scope,
  visit,
  children,
}: {
  scope?: FinancialScope;
  visit: string;
  children: ReactNode;
}) {
  // A committed workspace change invalidates registrations even within one account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handoff = useMemo(() => createHandoff(scope), [scope, visit]);
  return <Context.Provider value={handoff}>{children}</Context.Provider>;
}
function createHandoff(scope?: FinancialScope): Handoff {
  let current: { owner: object; receive: (entry: Entry) => void } | undefined;
  return {
    register(owner, receive) {
      current = { owner, receive };
      return () => {
        if (current?.owner === owner) current = undefined;
      };
    },
    activate(event, source) {
      if (
        !scope?.isLive() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (event.currentTarget.target && event.currentTarget.target !== '_self')
      )
        return;
      current?.receive({ source, focus: event.currentTarget.id });
    },
  };
}
export const useExpenseEntry = () => useContext(Context);
