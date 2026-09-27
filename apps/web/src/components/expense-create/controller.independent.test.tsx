// @vitest-environment jsdom
import { act, useEffect, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseCreationProvider, useExpenseCreation } from './controller';
import { createMockData } from '../../lib/data/mock';
import type {
  Entity,
  Outcome,
  Snapshot,
  ExpenseInput,
} from '../../lib/data/port';
const doubles = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  nav: {
    setDraftPending: vi.fn(),
    discardDraft: vi.fn(),
    returnToSource: vi.fn(),
  },
}));
vi.mock('../data-provider', () => ({
  useAppData: () => ({
    sessionEpoch: 0,
    acquirePendingOperation: () => () => {},
    ...doubles.data,
  }),
}));
vi.mock('../navigation/provider', () => ({
  useExpenseNavigation: () => doubles.nav,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
let root: Root;
let api: ReturnType<typeof useExpenseCreation>;
function Probe() {
  const value = useExpenseCreation();
  useEffect(() => {
    api = value;
  }, [value]);
  return null;
}
function render() {
  act(() =>
    root.render(
      <ExpenseCreationProvider>
        <Probe />
      </ExpenseCreationProvider>,
    ),
  );
}
async function snapshot(
  source: ReturnType<typeof createMockData>,
): Promise<Snapshot> {
  const result = await source.port.read('household-demo');
  if (result.status !== 'ok') throw new Error('fixture unavailable');
  return result.value;
}
function input(value: Snapshot): ExpenseInput {
  return {
    ...value.expenses[0],
    description: 'Independent create',
    amount: 1001,
    allocations: [
      { memberId: 'member-k', amount: 501 },
      { memberId: 'member-m', amount: 500 },
    ],
  };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.values(doubles.nav).forEach((fn) => fn.mockReset());
  window.history.replaceState(
    { kamiEntry: 'draft-entry' },
    '',
    '/drafts/new-expense?visit=origin',
  );
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('independent creation concurrency and recovery', () => {
  it('prevents same-operation double submit and does not navigate after the initiating route is left', async () => {
    const source = createMockData();
    const initial = await snapshot(source);
    let finish!: (value: Outcome<Entity>) => void;
    const execute = vi.fn(
      () =>
        new Promise<Outcome<Entity>>((resolve) => {
          finish = resolve;
        }),
    );
    doubles.data = {
      port: { ...source.port, execute },
      snapshot: initial,
      status: 'ready',
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    render();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = api.submit('new-expense', 'op-double', input(initial), 'origin');
      second = api.submit('new-expense', 'op-double', input(initial), 'origin');
    });
    expect(execute).toHaveBeenCalledOnce();
    window.history.replaceState({ kamiEntry: 'elsewhere' }, '', '/history');
    await act(async () => {
      finish({ status: 'ok', value: initial.expenses[0] });
      await Promise.all([first, second]);
    });
    expect(doubles.nav.discardDraft).toHaveBeenCalledWith('new-expense');
    expect(doubles.nav.returnToSource).not.toHaveBeenCalled();
  });
  it('blocks recovery when the actor changes while the operation lookup is pending', async () => {
    const source = createMockData();
    const initial = await snapshot(source);
    const execute = vi.fn().mockResolvedValue({ status: 'unknown' });
    let finish!: (value: { status: 'not-started' }) => void;
    const operation = vi.fn(
      () =>
        new Promise<{ status: 'not-started' }>((resolve) => {
          finish = resolve;
        }),
    );
    const port = { ...source.port, execute, operation };
    doubles.data = {
      port,
      snapshot: initial,
      status: 'ready',
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    render();
    await act(async () =>
      api.submit('new-expense', 'op-actor', input(initial), 'origin'),
    );
    let recovery!: Promise<void>;
    act(() => {
      recovery = api.recover('op-actor');
    });
    source.demo.actor('member-m');
    doubles.data = { ...doubles.data, snapshot: await snapshot(source) };
    render();
    await act(async () => {
      finish({ status: 'not-started' });
      await recovery;
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(api.states['op-actor'].phase).toBe('unknown');
  });
  it('does not submit a stale callback after household access has been revoked', async () => {
    const source = createMockData();
    const initial = await snapshot(source);
    const execute = vi.fn().mockResolvedValue({ status: 'denied' });
    doubles.data = {
      port: { ...source.port, execute },
      snapshot: initial,
      status: 'ready',
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    render();
    const staleSubmit = api.submit;
    doubles.data = { ...doubles.data, snapshot: undefined, status: 'denied' };
    render();
    await act(async () =>
      staleSubmit('new-expense', 'op-stale', input(initial), 'origin'),
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it('closes the current resumed visit after confirmed recovery without repeating the write', async () => {
    const source = createMockData();
    const initial = await snapshot(source);
    const execute = vi.fn().mockResolvedValue({ status: 'unknown' });
    const operation = vi
      .fn()
      .mockResolvedValue({ status: 'ok', value: initial.expenses[0] });
    doubles.data = {
      port: { ...source.port, execute, operation },
      snapshot: initial,
      status: 'ready',
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    render();
    await act(async () =>
      api.submit('new-expense', 'op-resume', input(initial), 'origin'),
    );
    expect(api.states['op-resume'].phase).toBe('unknown');
    expect(doubles.nav.setDraftPending).toHaveBeenLastCalledWith(
      'new-expense',
      true,
    );
    window.history.replaceState({ kamiEntry: 'elsewhere' }, '', '/history');
    window.history.replaceState(
      { kamiEntry: 'resumed-entry' },
      '',
      '/drafts/new-expense?visit=resumed',
    );
    await act(async () => api.recover('op-resume'));
    expect(execute).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith('household-demo', 'op-resume');
    expect(doubles.nav.discardDraft).toHaveBeenCalledOnce();
    expect(doubles.nav.returnToSource).toHaveBeenCalledExactlyOnceWith(
      'resumed',
    );
    expect(api.states['op-resume'].phase).toBe('saved');
  });
});
