// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppDataProvider } from './data-provider';
import { EntryPreview } from './entry-preview';
import { createMockData } from '../lib/data/mock';
import type { EntryState } from '../lib/data/entry';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => ({
    refreshVersion: 0,
    drafts: {},
    discardDraft: vi.fn(),
  }),
}));
vi.mock('next/link', () => ({ default: 'a' }));
it('does not let an older entry read restore an accepted invitation after a session reset', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const source = createMockData();
  await source.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'invitation',
  });
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'test@example.test',
  });
  await source.port.entry.dispatch({ kind: 'follow' });
  await source.port.entry.dispatch({ kind: 'accept' });
  const previous = await source.port.entry.read();
  let resolve!: (state: EntryState) => void;
  vi.spyOn(source.port.entry, 'read').mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AppDataProvider source={source}>
          <EntryPreview />
        </AppDataProvider>,
      ),
    );
    await act(async () => source.demo.reset());
    expect(container.textContent).toContain('Email address');
    await act(async () => resolve(previous));
    expect(container.textContent).toContain('Email address');
    expect(container.textContent).not.toContain(
      'Your simulated membership is active',
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});

it('does not route a user back after a delayed entry action completes on an unmounted screen', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  push.mockReset();
  const source = createMockData();
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'test@example.test',
  });
  const dispatch = source.port.entry.dispatch;
  let resolve!: (state: EntryState) => void;
  let completed!: EntryState;
  vi.spyOn(source.port.entry, 'dispatch').mockImplementation(async (action) => {
    completed = await dispatch(action);
    return new Promise((done) => {
      resolve = done;
    });
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AppDataProvider source={source}>
          <EntryPreview />
        </AppDataProvider>,
      ),
    );
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Open preview link')!
        .click(),
    );
    await act(async () =>
      root.render(
        <AppDataProvider source={source}>
          <p>Another screen</p>
        </AppDataProvider>,
      ),
    );
    await act(async () => resolve(completed));
    expect(push).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});
it('ignores a prior adapter entry completion after the provider changes to another source', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  push.mockReset();
  const source = createMockData();
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'test@example.test',
  });
  const dispatch = source.port.entry.dispatch;
  let resolve!: (state: EntryState) => void;
  let completed!: EntryState;
  vi.spyOn(source.port.entry, 'dispatch').mockImplementation(async (action) => {
    completed = await dispatch(action);
    return new Promise((done) => {
      resolve = done;
    });
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AppDataProvider source={source}>
          <EntryPreview />
        </AppDataProvider>,
      ),
    );
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Open preview link')!
        .click(),
    );
    const nextSource = createMockData();
    await act(async () =>
      root.render(
        <AppDataProvider source={nextSource}>
          <EntryPreview />
        </AppDataProvider>,
      ),
    );
    await act(async () => resolve(completed));
    expect(push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Email address');
    expect(container.textContent).not.toContain(
      'Your simulated membership is active',
    );
    expect((await nextSource.port.entry.read()).phase).toBe('request');
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});
