// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandFeedback } from './command-feedback';
import { Dialog } from './primitives';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('focuses the recovery action after its parent dialog opens and invokes only the explicit original-operation callback', async () => {
  const recover = vi.fn();
  await act(async () =>
    root.render(
      <Dialog open title="Retained expense" onClose={() => {}}>
        <CommandFeedback
          state={{ phase: 'unknown', message: 'The save may have completed.' }}
          onRecover={recover}
          recoveryLabel="Check original request"
        />
      </Dialog>,
    ),
  );
  expect(document.activeElement?.textContent).toBe('Check original request');
  expect(recover).not.toHaveBeenCalled();
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(recover).toHaveBeenCalledTimes(1);
});
it('does not steal focus into a retained closed dialog or after the action unmounts', async () => {
  const outside = document.createElement('button');
  outside.textContent = 'Current page';
  document.body.append(outside);
  outside.focus();
  await act(async () =>
    root.render(
      <Dialog open={false} title="Old form" onClose={() => {}}>
        <CommandFeedback
          state={{ phase: 'unknown', message: 'Unknown' }}
          onRecover={() => {}}
          recoveryLabel="Check original request"
        />
      </Dialog>,
    ),
  );
  expect(document.activeElement).toBe(outside);
  act(() =>
    root.render(
      <CommandFeedback
        state={{ phase: 'unknown', message: 'Unknown' }}
        onRecover={() => {}}
        recoveryLabel="Check original request"
      />,
    ),
  );
  act(() => root.render(<p>New page</p>));
  outside.focus();
  await act(async () => {});
  expect(document.activeElement).toBe(outside);
});
it('offers no retry action while submitting and removes feedback after confirmed completion', async () => {
  await act(async () =>
    root.render(
      <CommandFeedback
        state={{ phase: 'submitting', message: 'Checking' }}
        onRecover={() => {}}
        recoveryLabel="Check request"
      />,
    ),
  );
  expect(container.querySelector('button')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    'Checking',
  );
  await act(async () =>
    root.render(
      <CommandFeedback
        state={{ phase: 'saved', message: 'Saved' }}
        recoveryLabel="Check request"
      />,
    ),
  );
  expect(container.textContent).toBe('');
});
