'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  expenseHref,
  sourceDescriptor,
  type DraftValue,
  type SessionDraft,
  type SourceDescriptor,
} from './session';

type NavigationContext = {
  href: string;
  getSource: (visitId: string | null) => SourceDescriptor | undefined;
  sourceHref: (route: string) => string;
  openContext: (href: string, focusId: string) => void;
  openExpense: (id: string, focusId: string) => void;
  openDraft: (id: string, focusId: string) => void;
  replaceDestination: (href: string) => void;
  resumeDraft: (id: string) => void;
  returnToSource: (visitId: string | null) => void;
  refreshVersion: number;
  markRouteReady: (href: string, version: number) => void;
  announcement: string;
  drafts: Readonly<Record<string, SessionDraft>>;
  updateDraft: (id: string, values: DraftValue, label?: string) => void;
  setDraftPending: (id: string, pending: boolean) => void;
  discardDraft: (id: string) => void;
  removedFixtureIds: readonly string[];
  removeFixtureRecord: (id: string) => void;
};
const Context = createContext<NavigationContext | null>(null);
function ensureEntryId() {
  const existing = window.history.state?.kamiEntry;
  if (typeof existing === 'string') return existing;
  const id = crypto.randomUUID();
  window.history.replaceState({ ...window.history.state, kamiEntry: id }, '');
  return id;
}
function visiblePageHeading() {
  const topDialog = Array.from(document.querySelectorAll('dialog[open]')).at(
    -1,
  );
  return (
    topDialog?.querySelector<HTMLElement>('[data-page-heading], h2') ??
    document.querySelector<HTMLElement>(
      '.detail-slot .expense-page [data-page-heading]',
    ) ??
    document.querySelector<HTMLElement>('[data-page-heading]')
  );
}
function currentHref() {
  return window.location.pathname + window.location.search;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const href = pathname + (search.size ? `?${search}` : '');
  const sources = useRef(new Map<string, SourceDescriptor>());
  const previousVisit = useRef<string | null>(null);
  const processedEntry = useRef<string | null>(null);
  const forcedReturn = useRef<SourceDescriptor | null>(null);
  const pendingRestore = useRef<{
    source: SourceDescriptor;
    version: number;
  } | null>(null);
  const generation = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const [removedFixtureIds, setRemovedFixtureIds] = useState<string[]>([]);

  const capture = useCallback((focusId: string) => {
    const visit = crypto.randomUUID();
    sources.current.set(
      visit,
      sourceDescriptor(
        currentHref(),
        ensureEntryId(),
        focusId,
        { x: window.scrollX, y: window.scrollY },
        visit,
      ),
    );
    return visit;
  }, []);
  const openContext = useCallback(
    (target: string, focusId: string) => {
      const url = new URL(target, window.location.origin);
      if (url.origin !== window.location.origin)
        throw new Error('Context must stay in-app');
      url.searchParams.set('visit', capture(focusId));
      router.push(url.pathname + url.search, { scroll: false });
    },
    [capture, router],
  );
  const replaceDestination = useCallback(
    (target: string) => {
      const url = new URL(target, window.location.origin);
      if (url.origin !== window.location.origin)
        throw new Error('Destination must stay in-app');
      router.replace(url.pathname + url.search);
    },
    [router],
  );
  const openExpense = useCallback(
    (id: string, focusId: string) => {
      router.push(expenseHref(id, capture(focusId)), { scroll: false });
    },
    [capture, router],
  );
  const openDraft = useCallback(
    (id: string, focusId: string) => {
      openContext(`/drafts/${encodeURIComponent(id)}`, focusId);
    },
    [openContext],
  );
  const getSource = useCallback(
    (visitId: string | null) =>
      visitId ? sources.current.get(visitId) : undefined,
    [],
  );
  const returnToSource = useCallback(
    (visitId: string | null) => {
      const source = visitId ? sources.current.get(visitId) : undefined;
      if (!source) {
        router.replace('/history');
        return;
      }
      if (source.adjacent) router.back();
      else {
        // A resumed draft may return to an expense/bucket whose old visit was
        // adjacent in a different history entry. Copy that context for this new
        // entry; never change the older visit's Back/Forward semantics.
        const target = new URL(source.href, window.location.origin);
        const targetSource = sources.current.get(
          target.searchParams.get('visit') ?? '',
        );
        if (targetSource) {
          const targetVisit = crypto.randomUUID();
          sources.current.set(targetVisit, {
            ...targetSource,
            visitId: targetVisit,
            adjacent: false,
          });
          target.searchParams.set('visit', targetVisit);
        }
        const targetHref = target.pathname + target.search;
        forcedReturn.current = { ...source, href: targetHref };
        router.replace(targetHref, { scroll: false });
      }
    },
    [router],
  );
  const sourceHref = useCallback(
    (route: string) => {
      let candidate = href;
      const visited = new Set<string>();
      while (!visited.has(candidate)) {
        visited.add(candidate);
        const url = new URL(candidate, 'https://kami.invalid');
        if (url.pathname === route) return candidate;
        const source = getSource(url.searchParams.get('visit'));
        if (!source) break;
        candidate = source.href;
      }
      return route;
    },
    [href, getSource],
  );

  useEffect(() => {
    const visit = search.get('visit');

    if (visit)
      window.history.replaceState(
        { ...window.history.state, kamiEntry: visit },
        '',
      );
    else ensureEntryId();
    const entryKey = `${href}\0${window.history.state?.kamiEntry}`;
    if (processedEntry.current === entryKey) return;
    processedEntry.current = entryKey;
    const previous = forcedReturn.current ?? getSource(previousVisit.current);
    const forced = forcedReturn.current !== null;
    previousVisit.current = visit;
    if (
      previous &&
      previous.href === href &&
      (forced || window.history.state?.kamiEntry === previous.entryId)
    ) {
      forcedReturn.current = null;
      const version = ++generation.current;
      pendingRestore.current = { source: previous, version };
      setRefreshVersion(version);
      return;
    }
    pendingRestore.current = null;
    const frame = requestAnimationFrame(() => {
      // A mounted modal owns initial/validation focus; route focus must not
      // override its explicitly focused amount field or first invalid control.
      if (document.activeElement?.closest('dialog[open]')) return;
      visiblePageHeading()?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [href, search, getSource, router]);

  const markRouteReady = useCallback((readyHref: string, version: number) => {
    const pending = pendingRestore.current;
    if (
      !pending ||
      pending.source.href !== readyHref ||
      pending.version !== version
    )
      return;
    requestAnimationFrame(() => {
      if (pendingRestore.current !== pending) return;
      pendingRestore.current = null;
      const target = document.getElementById(pending.source.focusId);
      const heading = visiblePageHeading();
      (target ?? heading)?.focus({ preventScroll: true });
      window.scrollTo(pending.source.scroll.x, pending.source.scroll.y);
      setAnnouncement(
        target
          ? 'Returned to your previous view.'
          : 'The previous item is no longer in this view. Returned to the heading.',
      );
    });
  }, []);

  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [drafts]);
  const updateDraft = useCallback(
    (id: string, values: DraftValue, label = 'Expense draft') => {
      setDrafts((current) => ({
        ...current,
        [id]: {
          id,
          label,
          href: `/drafts/${encodeURIComponent(id)}`,
          values: structuredClone(values),
          operationId: current[id]?.operationId ?? crypto.randomUUID(),
          pending: current[id]?.pending ?? false,
          source:
            current[id]?.source ??
            getSource(new URLSearchParams(window.location.search).get('visit')),
        },
      }));
    },
    [getSource],
  );
  const resumeDraft = useCallback(
    (id: string) => {
      const draft = drafts[id];
      if (!draft) return;
      if (!draft.source) {
        router.push(draft.href);
        return;
      }
      const visit = crypto.randomUUID();
      sources.current.set(visit, {
        ...draft.source,
        visitId: visit,
        adjacent: false,
      });
      router.push(`${draft.href}?visit=${visit}`, { scroll: false });
    },
    [drafts, router],
  );
  const setDraftPending = useCallback((id: string, pending: boolean) => {
    setDrafts((current) =>
      current[id] ? { ...current, [id]: { ...current[id], pending } } : current,
    );
  }, []);
  const discardDraft = useCallback((id: string) => {
    setDrafts((current) => {
      if (current[id]?.pending) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const removeFixtureRecord = useCallback(
    (id: string) =>
      setRemovedFixtureIds((current) => [...new Set([...current, id])]),
    [],
  );
  const value = useMemo(
    () => ({
      href,
      getSource,
      sourceHref,
      openContext,
      replaceDestination,
      openExpense,
      openDraft,
      resumeDraft,
      returnToSource,
      refreshVersion,
      markRouteReady,
      announcement,
      drafts,
      updateDraft,
      setDraftPending,
      discardDraft,
      removedFixtureIds,
      removeFixtureRecord,
    }),
    [
      href,
      getSource,
      sourceHref,
      openContext,
      replaceDestination,
      openExpense,
      openDraft,
      resumeDraft,
      returnToSource,
      refreshVersion,
      markRouteReady,
      announcement,
      drafts,
      updateDraft,
      setDraftPending,
      discardDraft,
      removedFixtureIds,
      removeFixtureRecord,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useExpenseNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error('NavigationProvider is required');
  return value;
}
export function useSessionDraft<T extends DraftValue = DraftValue>(id: string) {
  const { drafts, updateDraft, setDraftPending, discardDraft } =
    useExpenseNavigation();
  return {
    draft: drafts[id] as SessionDraft<T> | undefined,
    update: (values: T, label?: string) => updateDraft(id, values, label),
    setPending: (pending: boolean) => setDraftPending(id, pending),
    discard: () => discardDraft(id),
  };
}
/** A retained background reads its own source URL, not the foreground detail URL. */
export function useRouteContext(route: string) {
  const {
    sourceHref,
    refreshVersion,
    href: activeHref,
  } = useExpenseNavigation();
  const href = sourceHref(route);
  return {
    href,
    searchParams: new URL(href, 'https://kami.invalid').searchParams,
    refreshVersion,
    isActive: new URL(activeHref, 'https://kami.invalid').pathname === route,
  };
}
/** Pass the generation of fresh rendered data, or null while fetching. */
export function useRouteReady(route: string, readyVersion: number | null) {
  const { markRouteReady } = useExpenseNavigation();
  const { href } = useRouteContext(route);
  useEffect(() => {
    if (readyVersion !== null) markRouteReady(href, readyVersion);
  }, [href, readyVersion, markRouteReady]);
}
