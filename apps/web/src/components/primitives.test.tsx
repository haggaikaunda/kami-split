// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  Confirmation,
  Dialog,
  ErrorSummary,
  Field,
  Member,
  SelectField,
  Skeleton,
  Status,
} from './ui/primitives';
import { ChartTable, Money } from './financial/presentation';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // jsdom has no top-layer implementation; real-browser verification covers Tab/inert behavior.
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

describe('accessible UI primitives', () => {
  it('links labels, existing hints and errors to fields and focuses error links', () => {
    act(() =>
      root.render(
        <>
          <Field
            id="amount"
            label="Amount"
            hint="Use two decimal places"
            error="Enter a positive amount"
            aria-describedby="currency"
          />
          <span id="currency">USD</span>
          <SelectField id="payer" label="Paid by" error="Choose a member">
            <option>Choose</option>
          </SelectField>
          <ErrorSummary
            errors={[{ fieldId: 'amount', message: 'Check amount' }]}
          />
        </>,
      ),
    );
    const input = container.querySelector('input')!;
    expect(input.labels?.[0].textContent).toBe('Amount');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby')!.split(' ');
    expect(
      describedBy.map((id) => document.getElementById(id)?.textContent),
    ).toEqual(['USD', 'Use two decimal places', 'Enter a positive amount']);
    expect(container.querySelector('select')!.labels?.[0].textContent).toBe(
      'Paid by',
    );
    act(() => container.querySelector('a')!.click());
    expect(document.activeElement).toBe(input);
  });

  it('pending buttons prevent repeated activation and default away from submit', () => {
    const action = vi.fn();
    act(() =>
      root.render(
        <Button pending onClick={action}>
          Save expense
        </Button>,
      ),
    );
    const button = container.querySelector('button')!;
    act(() => button.click());
    expect(action).not.toHaveBeenCalled();
    expect(button.type).toBe('button');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('opens a named modal, handles Escape request, and restores trigger focus', () => {
    const trigger = document.createElement('button');
    document.body.prepend(trigger);
    trigger.focus();
    const close = vi.fn();
    act(() =>
      root.render(
        <Dialog open title="Edit expense" onClose={close}>
          <Field label="Description" />
        </Dialog>,
      ),
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby')!)!
        .textContent,
    ).toBe('Edit expense');
    expect(document.activeElement).toBe(container.querySelector('h2'));
    const cancel = new Event('cancel', { cancelable: true });
    act(() => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    act(() =>
      root.render(
        <Dialog open={false} title="Edit expense" onClose={close}>
          Content
        </Dialog>,
      ),
    );
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab and Shift+Tab at modal edges', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    act(() =>
      root.render(
        <Dialog open title="Keyboard" onClose={vi.fn()}>
          <Field label="Amount" />
          <Button>Save</Button>
        </Dialog>,
      ),
    );
    const buttons = container.querySelectorAll('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    act(() =>
      last.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(first);
    act(() =>
      first.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(last);
  });

  it('focuses safe confirmation action and restores explicit surviving target', () => {
    const fallback = document.createElement('button');
    document.body.prepend(fallback);
    const returnFocus = createRef<HTMLElement>();
    returnFocus.current = fallback;
    const cancel = vi.fn();
    act(() =>
      root.render(
        <Confirmation
          open
          title="Discard draft?"
          confirmLabel="Discard changes"
          onCancel={cancel}
          onConfirm={vi.fn()}
        >
          Changes will be lost.
        </Confirmation>,
      ),
    );
    expect(document.activeElement?.textContent).toBe('Keep editing');
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(cancel).toHaveBeenCalledOnce();
    act(() =>
      root.render(
        <Dialog
          open
          title="Details"
          onClose={vi.fn()}
          returnFocusRef={returnFocus}
        >
          Content
        </Dialog>,
      ),
    );
    act(() => root.render(null));
    expect(document.activeElement).toBe(fallback);
  });

  it('restores a surviving page when a mutation removes the trigger', () => {
    const main = document.createElement('main');
    document.body.prepend(main);
    const trigger = document.createElement('button');
    main.append(trigger);
    trigger.focus();
    act(() =>
      root.render(
        <Dialog open title="Delete" onClose={vi.fn()}>
          Content
        </Dialog>,
      ),
    );
    trigger.remove();
    act(() => root.render(null));
    expect(document.activeElement).toBe(main);
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('renders exact text, photo fallback, named states and chart table equivalence', () => {
    const select = vi.fn();
    act(() =>
      root.render(
        <>
          <Money value="9,999,999.99" currency="USD" />
          <Member name="Alpha Beta" photo="/missing.png" />
          <Skeleton />
          <Status kind="denied">Return to your household.</Status>
          <ChartTable
            title="September"
            currency="USD"
            rows={[
              {
                id: 'day',
                label: 'Sep 20',
                value: '10.01',
                count: 2,
                magnitude: 1001,
              },
              {
                id: 'zero',
                label: 'Sep 21',
                value: '0.00',
                count: 0,
                magnitude: 0,
              },
            ]}
            onSelect={select}
          />
        </>,
      ),
    );
    expect(container.textContent).toContain('9,999,999.99 USD');
    act(() =>
      container.querySelector('img')!.dispatchEvent(new Event('error')),
    );
    expect(container.querySelector('[data-ui~="avatar"]')!.textContent).toBe(
      'AB',
    );
    expect(
      container.querySelector('[data-ui~="loading"]')!.textContent,
    ).not.toContain('0.00');
    expect(container.textContent).toContain('Unavailable');
    const zero = container.querySelector(
      '[aria-label="Sep 21: 0.00 USD, 0 expenses"]',
    ) as HTMLButtonElement;
    act(() => zero.click());
    expect(select).toHaveBeenCalledWith('zero');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody')!.textContent).toContain(
      '10.01 USD2',
    );
  });
});
