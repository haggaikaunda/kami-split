'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import helpStyles from './rich-help.module.css';

/** Optional rich help opens on activation, with a dismiss action and no modal trap. */
export function RichHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    maxHeight: 'calc(100dvh - 16px)',
    maxWidth: 'calc(100vw - 16px)',
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge =
        topEdge + (viewport?.height ?? window.innerHeight) - 16;
      if (anchor.bottom <= topEdge || anchor.top >= bottomEdge) {
        setOpen(false);
        return;
      }
      const below = anchor.bottom + 8;
      const aboveSpace = Math.max(0, anchor.top - topEdge - 8);
      const belowSpace = Math.max(0, bottomEdge - below);
      const useBelow =
        box.height <= belowSpace ||
        (box.height > aboveSpace && belowSpace >= aboveSpace);
      const available = useBelow ? belowSpace : aboveSpace;
      const height = Math.min(box.height, available);
      setPosition({
        left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - box.width)),
        top: useBelow ? below : anchor.top - height - 8,
        maxHeight: `${available}px`,
        maxWidth: `${rightEdge - leftEdge}px`,
      });
    };
    place();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(place)
        : undefined;
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener('workspace-rich-help', closeOther);
    return () => window.removeEventListener('workspace-rich-help', closeOther);
  }, [id]);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (panel.current?.contains(target) || trigger.current?.contains(target));
    const outside = (event: Event) => {
      if (!inside(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-ui="rich-help-trigger form-button"
        className={helpStyles['rich-help-trigger']}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onKeyDown={(event) => {
          if (open && event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            panel.current?.querySelector('button')?.focus();
          }
        }}
        onClick={() => {
          if (!open)
            window.dispatchEvent(
              new CustomEvent('workspace-rich-help', { detail: id }),
            );
          setOpen(!open);
        }}
      >
        {label}
        <span
          aria-hidden="true"
          data-ui="rich-help-info"
          className={helpStyles['rich-help-info']}
        >
          ⓘ
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            data-ui="rich-help-panel"
            className={helpStyles['rich-help-panel']}
            style={position}
            onKeyDown={(event) => {
              if (
                event.key === 'Tab' &&
                event.shiftKey &&
                event.target === panel.current?.querySelector('button')
              ) {
                event.preventDefault();
                trigger.current?.focus();
              } else if (event.key === 'Tab' && !event.shiftKey) {
                // Resume native tab order from the anchor rather than the
                // portal at the end of the document.
                setOpen(false);
                trigger.current?.focus();
              }
            }}
          >
            <strong>{label}</strong>
            <div
              data-ui="rich-help-copy"
              className={helpStyles['rich-help-copy']}
            >
              {children}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
              data-ui="form-button"
            >
              Got it
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export const shareHelp =
  'Your part of the shared expenses, even if someone else paid. Repayments do not change your share.';
export const balanceHelp =
  'Your balance combines what you owe and what you are owed. Other members may still owe each other. Payments are settled within their own groups or trips.';
export const householdScopeHelp =
  'Your Household expenses, plus groups and trips that everyone in your household belongs to. Each keeps its own balances.';

export function BalanceExplanation({
  household = false,
}: {
  household?: boolean;
}) {
  return (
    <div
      data-ui="balance-explanations"
      className={helpStyles['balance-explanations']}
    >
      <details>
        <summary>How your balance works</summary>
        <p>
          Your balance compares what you paid with your share, including
          recorded repayments you sent and received. A positive balance means
          you’re owed money; a negative balance means you owe money. Recording a
          repayment does not move money.
        </p>
      </details>
      <details>
        <summary>See an example</summary>
        <p>
          Paying $60.00 with a $20.00 share means you are owed $40.00. Receiving
          a $15.00 repayment leaves $25.00 owed to you. Paying nothing with a
          $20.00 share means you owe $20.00; sending a $5.00 repayment leaves
          $15.00 to pay.
        </p>
      </details>
      {household && (
        <details>
          <summary>Why can my total be $0?</summary>
          <p>
            What you owe in one group or trip can offset what you are owed in
            another. Those payments still need to be settled within their own
            groups or trips. Your zero balance also does not settle payments
            between other members.
          </p>
        </details>
      )}
    </div>
  );
}
