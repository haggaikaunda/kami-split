// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from './data-provider';
import { createMockData } from '@/lib/data/mock';
import type { Outcome, Snapshot } from '@/lib/data/port';
const navigation = vi.hoisted(() => ({
  refreshVersion: 0,
  drafts: {},
  discardDraft: vi.fn(),
}));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => navigation,
}));
let root: Root;
let api: AppData;
function Probe() {
  const value = useAppData();
  useEffect(() => {
    api = value;
  }, [value]);
  return <p>{value.status}</p>;
}
async function mount(source: AppDataSource) {
  await act(async () => {
    root.render(
      <AppDataProvider source={source}>
        <Probe />
      </AppDataProvider>,
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  navigation.refreshVersion = 0;
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('session app data boundary', () => {
  it('loads the seed and clears financial snapshots on denied and expired access', async () => {
    const source = createMockData();
    await mount(source);
    expect(api.status).toBe('ready');
    expect(api.snapshot?.members[0].name).toBe('Kaunda');
    expect(api.readyVersion).toBe(0);
    await act(async () => api.demo!.scenario('denied'));
    expect(api.status).toBe('denied');
    expect(api.snapshot).toBeUndefined();
    await act(async () => api.demo!.scenario('normal'));
    expect(api.snapshot?.household.id).toBe('household-demo');
    await act(async () => api.demo!.scenario('expired'));
    expect(api.status).toBe('expired');
    expect(api.snapshot).toBeUndefined();
  });
  it('shows offline data explicitly stale and initial offline as an error without a fabricated snapshot', async () => {
    const source = createMockData();
    await mount(source);
    const before = api.snapshot;
    await act(async () => api.demo!.scenario('offline'));
    expect(api.status).toBe('stale');
    expect(api.snapshot).toBe(before);
    await act(async () => api.demo!.scenario('denied'));
    await act(async () => api.demo!.scenario('offline'));
    expect(api.status).toBe('error');
    expect(api.failure).toBe('offline');
    expect(api.snapshot).toBeUndefined();
  });
  it('ignores an older completion after a new invalidation and acknowledges only the captured navigation generation', async () => {
    const mock = createMockData();
    const sample = await mock.port.read('household-demo');
    if (sample.status !== 'ok') throw new Error('fixture unavailable');
    const requests: ((value: Outcome<Snapshot>) => void)[] = [];
    const read = vi.fn(
      () => new Promise<Outcome<Snapshot>>((resolve) => requests.push(resolve)),
    );
    const source = { port: { ...mock.port, read }, demo: mock.demo };
    await mount(source);
    expect(api.status).toBe('loading');
    expect(api.readyVersion).toBeNull();
    await act(async () => mock.demo.scenario('normal'));
    await act(async () => requests[1]({ status: 'denied' }));
    await act(async () => requests[0](sample));
    expect(api.status).toBe('denied');
    expect(api.snapshot).toBeUndefined();
    navigation.refreshVersion = 7;
    await mount(source);
    expect(api.readyVersion).toBeNull();
    await act(async () => requests[2](sample));
    expect(api.status).toBe('ready');
    expect(api.readyVersion).toBe(7);
  });
  it('requeries after a committed mutation, retaining exact revised data', async () => {
    const source = createMockData();
    await mount(source);
    const row = api.snapshot!.expenses[0];
    await act(async () => {
      await api.port.execute({
        householdId: 'household-demo',
        operationId: 'delete-from-provider-test',
        command: {
          kind: 'delete-expense',
          id: row.id,
          expectedVersion: row.version,
          reason: 'test',
        },
      });
    });
    expect(
      api.snapshot!.expenses.find((expense) => expense.id === row.id)?.deleted,
    ).toBe(true);
    expect(api.snapshot!.activity[0].kind).toBe('deleted');
  });
});

it('blocks resets until all leases release and advances the epoch only on reset', async () => {
  await mount(createMockData());
  const initial = api.sessionEpoch;
  let releaseA!: () => void;
  let releaseB!: () => void;
  await act(async () => {
    releaseA = api.acquirePendingOperation('same-operation');
    releaseB = api.acquirePendingOperation('same-operation');
    api.demo!.reset('empty');
  });
  expect(api.pendingOperations).toBe(1);
  expect(api.sessionEpoch).toBe(initial);
  expect(api.snapshot!.expenses.length).toBeGreaterThan(0);
  await act(async () => {
    releaseA();
    releaseA();
    api.demo!.reset('empty');
  });
  expect(api.pendingOperations).toBe(1);
  expect(api.sessionEpoch).toBe(initial);
  await act(async () => api.demo!.actor('member-m'));
  await act(async () => api.demo!.scenario('denied'));
  await act(async () => api.demo!.scenario('normal'));
  expect(api.sessionEpoch).toBe(initial);
  await act(async () => {
    releaseB();
    api.demo!.reset('empty');
  });
  expect(api.pendingOperations).toBe(0);
  expect(api.sessionEpoch).toBe(initial + 1);
  expect(api.snapshot!.expenses).toHaveLength(0);
});
