// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../lib/data/mock';
import { fixture } from '../lib/data/fixtures';
import type { Outcome, Snapshot } from '../lib/data/port';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from './data-provider';

const navigation = vi.hoisted(() => ({
  refreshVersion: 0,
  drafts: {} as Record<string, { pending: boolean }>,
  discardDraft: vi.fn(),
}));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => navigation,
}));
let root: Root;
let container: HTMLDivElement;
let api: AppData;
function Probe() {
  const current = useAppData();
  useEffect(() => {
    api = current;
  }, [current]);
  return (
    <div>
      {current.status}
      <span>{current.snapshot?.household.name}</span>
    </div>
  );
}
async function mount(source: AppDataSource, householdId = 'household-demo') {
  await act(async () =>
    root.render(
      <AppDataProvider source={source} householdId={householdId}>
        <Probe />
      </AppDataProvider>,
    ),
  );
}
function deferred() {
  let resolve!: (value: Outcome<Snapshot>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Outcome<Snapshot>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  navigation.refreshVersion = 0;
  navigation.drafts = {};
  navigation.discardDraft.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('independent application data boundary acceptance probes', () => {
  it.each(['source', 'household'])(
    'hides prior financial context immediately when %s changes',
    async (boundary) => {
      const original = createMockData();
      await mount(original);
      expect(container.textContent).toContain('Our household');
      const nextRead = deferred();
      const next =
        boundary === 'source'
          ? {
              port: {
                ...createMockData().port,
                read: vi.fn(() => nextRead.promise),
              },
            }
          : original;
      if (boundary === 'household')
        vi.spyOn(original.port, 'read').mockImplementation(
          () => nextRead.promise,
        );
      const household =
        boundary === 'household' ? 'household-other' : 'household-demo';
      await mount(next, household);
      expect(api.status).toBe('loading');
      expect(api.snapshot).toBeUndefined();
      expect(container.textContent).not.toContain('Our household');
      expect(next.port.read).toHaveBeenCalledWith(household);
      await act(async () => nextRead.resolve({ status: 'denied' }));
      expect(api.status).toBe('denied');
      expect(api.snapshot).toBeUndefined();
    },
  );

  it('ignores an older failed refresh after switching to a successfully loaded source', async () => {
    const base = createMockData();
    const oldRead = deferred();
    const old = { port: { ...base.port, read: vi.fn(() => oldRead.promise) } };
    await mount(old);
    const current = createMockData({ fixture: 'empty' });
    navigation.refreshVersion = 8;
    await mount(current);
    expect(api.status).toBe('ready');
    expect(api.readyVersion).toBe(8);
    expect(api.snapshot?.expenses).toHaveLength(0);
    await act(async () => oldRead.reject(new Error('Late old failure')));
    expect(api.status).toBe('ready');
    expect(api.readyVersion).toBe(8);
    expect(api.snapshot?.expenses).toHaveLength(0);
  });

  it('marks an unresolved refresh unready and never lets an older success replace a newer failure', async () => {
    const base = createMockData();
    const first = deferred(),
      second = deferred();
    const reads = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const source = { port: { ...base.port, read: reads } };
    await mount(source);
    let refresh!: Promise<void>;
    act(() => {
      refresh = api.refresh();
    });
    expect(api.readyVersion).toBeNull();
    await act(async () => second.resolve({ status: 'expired' }));
    await act(async () =>
      first.resolve({ status: 'ok', value: fixture('sample', '2026-09-20') }),
    );
    await refresh;
    expect(api.status).toBe('expired');
    expect(api.snapshot).toBeUndefined();
    expect(container.textContent).not.toContain('Our household');
  });

  it('prevents reset from abandoning a pending operation and clears finished drafts on reset', async () => {
    const source = createMockData();
    const reset = vi.spyOn(source.demo, 'reset');
    navigation.drafts = {
      pending: { pending: true },
      dirty: { pending: false },
    };
    await mount(source);
    await act(async () => api.demo!.reset('empty'));
    expect(reset).not.toHaveBeenCalled();
    expect(navigation.discardDraft).not.toHaveBeenCalled();
    expect(api.snapshot?.expenses).toHaveLength(24);
    navigation.drafts = {
      pending: { pending: false },
      dirty: { pending: false },
    };
    await mount(source);
    await act(async () => api.demo!.reset('empty'));
    expect(reset).toHaveBeenCalledWith('empty');
    expect(
      navigation.discardDraft.mock.calls.map((call) => call[0]).sort(),
    ).toEqual(['dirty', 'pending']);
    expect(api.status).toBe('ready');
    expect(api.snapshot?.expenses).toHaveLength(0);
    expect(api.snapshot?.activity).toHaveLength(0);
  });
});
