// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Dialog, Field, Member, SelectField } from './ui/primitives';

let container: HTMLDivElement;
let root: Root;
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

describe('independent primitive acceptance probes', () => {
  it('keeps generated labels and descriptions distinct across multiple controls', () => {
    act(() =>
      root.render(
        <>
          <Field label="Amount" hint="USD" error="Positive amount required" />
          <Field label="Description" hint="Short description" />
          <SelectField label="Payer" hint="Choose a member" error="Required">
            <option>Choose</option>
          </SelectField>
        </>,
      ),
    );
    const controls = [...container.querySelectorAll('input,select')] as (
      HTMLInputElement | HTMLSelectElement
    )[];
    expect(new Set(controls.map((control) => control.id)).size).toBe(3);
    expect(controls.map((control) => control.labels?.[0].textContent)).toEqual([
      'Amount',
      'Description',
      'Payer',
    ]);
    expect(
      controls.map((control) =>
        control
          .getAttribute('aria-describedby')!
          .split(' ')
          .map((id) => document.getElementById(id)!.textContent),
      ),
    ).toEqual([
      ['USD', 'Positive amount required'],
      ['Short description'],
      ['Choose a member', 'Required'],
    ]);
    act(() => root.render(<Field label="Amount" />));
    expect(container.querySelector('input')!.hasAttribute('aria-invalid')).toBe(
      false,
    );
    expect(
      container.querySelector('input')!.hasAttribute('aria-describedby'),
    ).toBe(false);
  });

  it('keeps disabled and negative-tabindex controls outside the edge focus loop', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    act(() =>
      root.render(
        <Dialog open title="Focus edges" onClose={vi.fn()}>
          <Button>Save</Button>
          <Button disabled>Disabled</Button>
          <Button tabIndex={-1}>Programmatic only</Button>
        </Dialog>,
      ),
    );
    const [close, save] = container.querySelectorAll('button');
    close.focus();
    act(() =>
      close.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(save);
    act(() =>
      save.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(close);
  });

  it('honors explicit initial focus and does not close when a controlled consumer keeps it open', () => {
    const focus = createRef<HTMLInputElement>();
    const close = vi.fn();
    act(() =>
      root.render(
        <Dialog
          open
          title="Dirty draft"
          initialFocusRef={focus}
          onClose={close}
        >
          <input aria-label="Draft" ref={focus} />
        </Dialog>,
      ),
    );
    expect(document.activeElement).toBe(focus.current);
    const dialog = container.querySelector('dialog')!;
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(close).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    expect(focus.current!.isConnected).toBe(true);
  });

  it('retries changed photo sources after a failed image and retains the visible member name', () => {
    act(() =>
      root.render(
        <Member name="Alpha Beta" photo="/failed.png" detail="Owner" />,
      ),
    );
    act(() =>
      container.querySelector('img')!.dispatchEvent(new Event('error')),
    );
    expect(container.querySelector('[data-ui~="avatar"]')!.textContent).toBe(
      'AB',
    );
    expect(container.textContent).toContain('Alpha Beta');
    act(() =>
      root.render(
        <Member name="Alpha Beta" photo="/replacement.png" detail="Owner" />,
      ),
    );
    expect(container.querySelector('img')!.getAttribute('src')).toBe(
      '/replacement.png',
    );
    expect(container.querySelector('img')!.alt).toBe('');
    expect(
      container
        .querySelector('[data-ui~="avatar"]')!
        .getAttribute('aria-hidden'),
    ).toBe('true');
  });
});
