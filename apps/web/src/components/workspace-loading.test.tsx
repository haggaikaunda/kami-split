// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkspaceLoading } from './workspace-loading';

it('snapshots the latest size before removing private data, then releases height on completion or failure', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  let privateHeight = 400;
  const measure = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return {
        height: this.textContent?.includes('Private row') ? privateHeight : 80,
      } as DOMRect;
    });
  try {
    act(() =>
      root.render(
        <WorkspaceLoading busy={false}>Private row</WorkspaceLoading>,
      ),
    );
    // Text resizing can happen immediately before refresh, without an observer delivery.
    privateHeight = 900;
    act(() => root.render(<WorkspaceLoading busy>Loading…</WorkspaceLoading>));
    const surface = host.firstElementChild as HTMLElement;
    expect(surface.style.minHeight).toBe('900px');
    expect(host.textContent).not.toContain('Private row');
    act(() =>
      root.render(<WorkspaceLoading busy>Still loading…</WorkspaceLoading>),
    );
    expect(surface.style.minHeight).toBe('900px');
    act(() =>
      root.render(
        <WorkspaceLoading busy={false}>
          Unavailable. Try again.
        </WorkspaceLoading>,
      ),
    );
    expect(surface.style.minHeight).toBe('');
    act(() =>
      root.render(
        <WorkspaceLoading busy={false}>Private row</WorkspaceLoading>,
      ),
    );
    privateHeight = 300;
    act(() => root.render(<WorkspaceLoading busy>Loading…</WorkspaceLoading>));
    expect(surface.style.minHeight).toBe('300px');
    act(() =>
      root.render(
        <WorkspaceLoading busy={false}>Private row</WorkspaceLoading>,
      ),
    );
    expect(surface.style.minHeight).toBe('');
  } finally {
    act(() => root.unmount());
    measure.mockRestore();
  }
});
