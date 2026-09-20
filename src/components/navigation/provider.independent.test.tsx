// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationProvider, useExpenseNavigation } from './provider';

const route = vi.hoisted(() => ({
  pathname: '/history',
  search: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => route.search,
  useRouter: () => route.router,
}));
let api: ReturnType<typeof useExpenseNavigation>;
let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
function Probe() {
  const navigation = useExpenseNavigation();
  useEffect(() => {
    api = navigation;
  }, [navigation]);
  return (
    <>
      <h1 data-page-heading tabIndex={-1}>
        Destination
      </h1>
      <button id="row">Source record</button>
    </>
  );
}
function render() {
  act(() =>
    root.render(
      <NavigationProvider>
        <Probe />
      </NavigationProvider>,
    ),
  );
}
function navigate(href: string, state: Record<string, unknown> = {}) {
  window.history.replaceState(state, '', href);
  const url = new URL(href, window.location.origin);
  route.pathname = url.pathname;
  route.search = url.searchParams;
  render();
}
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((frame) => frame(0)));
}
function pushedHref() {
  return route.router.push.mock.calls.at(-1)![0] as string;
}
function visit(href: string) {
  return new URL(href, window.location.origin).searchParams.get('visit')!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  frames = new Map();
  frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  navigate('/history?category=Dining', {
    kamiEntry: 'source-entry',
    __NA: true,
  });
  flushFrames();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function returnFromExpense() {
  act(() => api.openExpense('102', 'row'));
  const detail = pushedHref();
  navigate(detail, { __NA: true });
  flushFrames();
  navigate('/history?category=Dining', {
    kamiEntry: 'source-entry',
    __NA: true,
  });
  return detail;
}

describe('independent navigation provider acceptance probes', () => {
  it('returns through nested resumed sources without borrowing old history adjacency', () => {
    act(() => api.openExpense('102', 'row'));
    const originalDetail = pushedHref();
    navigate(originalDetail, { __NA: true });
    flushFrames();
    act(() => api.openDraft('edit-102', 'row'));
    navigate(pushedHref(), { __NA: true });
    flushFrames();
    act(() => api.updateDraft('edit-102', { description: 'Retained edit' }));
    navigate('/household', { kamiEntry: 'unrelated' });
    flushFrames();
    act(() => api.resumeDraft('edit-102'));
    const resumed = pushedHref();
    navigate(resumed, { __NA: true });
    flushFrames();
    act(() => api.returnToSource(visit(resumed)));
    const returnedDetail = route.router.replace.mock.calls.at(-1)![0] as string;
    expect(new URL(returnedDetail, window.location.origin).pathname).toBe(
      '/expenses/102',
    );
    expect(visit(returnedDetail)).not.toBe(visit(originalDetail));
    expect(api.getSource(visit(originalDetail))?.adjacent).toBe(true);
    navigate(returnedDetail, { __NA: true });
    flushFrames();
    act(() => api.returnToSource(visit(returnedDetail)));
    expect(route.router.replace).toHaveBeenLastCalledWith(
      '/history?category=Dining',
      { scroll: false },
    );
    expect(route.router.back).not.toHaveBeenCalled();
    expect(api.drafts['edit-102'].values.description).toBe('Retained edit');
  });

  it('waits for the exact source and fresh generation before restoring focus and scroll', () => {
    returnFromExpense();
    expect(api.refreshVersion).toBe(1);
    const heading = container.querySelector('h1')!;
    heading.focus();
    act(() => {
      api.markRouteReady('/history?category=Dining', 0);
      api.markRouteReady('/trips', 1);
    });
    flushFrames();
    expect(document.activeElement).toBe(heading);
    expect(window.scrollTo).not.toHaveBeenCalled();
    act(() => api.markRouteReady('/history?category=Dining', 1));
    flushFrames();
    expect(document.activeElement?.id).toBe('row');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(api.announcement).toBe('Returned to your previous view.');
    expect(window.history.state.__NA).toBe(true);
  });

  it('does not restore stale source focus after navigation overtakes a queued ready callback', () => {
    returnFromExpense();
    act(() => api.markRouteReady('/history?category=Dining', 1));
    navigate('/trips', { kamiEntry: 'trip-entry' });
    flushFrames();
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('announces and focuses a surviving heading when fresh source data removes the row', () => {
    returnFromExpense();
    const button = container.querySelector('button')!;
    button.id = 'removed-record';
    act(() => api.markRouteReady('/history?category=Dining', 1));
    flushFrames();
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(api.announcement).toContain('previous item is no longer');
    button.id = 'row';
  });

  it('focuses the modal bucket heading rather than its inert background after row removal', () => {
    returnFromExpense();
    const button = container.querySelector('button')!;
    button.id = 'removed-record';
    const dialog = document.createElement('dialog');
    dialog.open = true;
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    heading.textContent = 'Selected chart bucket';
    dialog.append(heading);
    document.body.append(dialog);
    act(() => api.markRouteReady('/history?category=Dining', 1));
    flushFrames();
    expect(document.activeElement).toBe(heading);
    expect(api.announcement).toContain('previous item is no longer');
    button.id = 'row';
  });

  it('restores a nested draft origin that itself has a contextual expense visit', () => {
    act(() => api.openExpense('102', 'row'));
    const detail = pushedHref();
    navigate(detail, { __NA: true });
    flushFrames();
    act(() => api.openDraft('edit-102', 'row'));
    const draft = pushedHref();
    expect(api.getSource(visit(draft))?.href).toBe(detail);
    navigate(draft, { __NA: true });
    flushFrames();
    expect(api.sourceHref('/history')).toBe('/history?category=Dining');
    navigate(detail, { kamiEntry: visit(detail), __NA: true });
    expect(api.refreshVersion).toBe(1);
    act(() => api.markRouteReady(detail, 1));
    flushFrames();
    expect(document.activeElement?.id).toBe('row');
  });

  it('clones structured drafts, preserves pending identity, and resumes with the original source', () => {
    navigate('/trips/maui?tab=expenses&search=Poke', {
      kamiEntry: 'trip-origin',
    });
    flushFrames();
    act(() => api.openDraft('new', 'row'));
    const draftHref = pushedHref();
    navigate(draftHref, { __NA: true });
    flushFrames();
    const values = {
      participants: ['a', 'b'],
      allocations: [{ memberId: 'a', amount: 1001 }],
      note: 'Private note',
    };
    act(() => api.updateDraft('new', values));
    const operationId = api.drafts.new.operationId;
    values.allocations[0].amount = 1;
    expect(api.drafts.new.values.allocations).toEqual([
      { memberId: 'a', amount: 1001 },
    ]);
    act(() => api.setDraftPending('new', true));
    act(() => api.discardDraft('new'));
    expect(api.drafts.new.operationId).toBe(operationId);
    expect(api.drafts.new.pending).toBe(true);
    navigate('/household', { kamiEntry: 'unrelated' });
    flushFrames();
    act(() => api.resumeDraft('new'));
    const resumed = pushedHref();
    expect(resumed).not.toContain('Private');
    const source = api.getSource(visit(resumed))!;
    expect(source.href).toBe('/trips/maui?tab=expenses&search=Poke');
    expect(source.adjacent).toBe(false);
    navigate(resumed, { __NA: true });
    flushFrames();
    act(() => api.returnToSource(visit(resumed)));
    expect(route.router.replace).toHaveBeenLastCalledWith(source.href, {
      scroll: false,
    });
    expect(route.router.back).not.toHaveBeenCalled();
    expect(api.drafts.new.operationId).toBe(operationId);
  });
});
