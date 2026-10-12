'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { containDialogFocus } from '@/components/primitives';
import './ledger.css';
import { AppIcon } from '@/components/workspace-identity';

/** One mounted presentation preserves form drafts across responsive changes. */
export function ExpensePresentation({
  title,
  kind = 'detail',
  onClose,
  children,
}: {
  title: string;
  kind?: 'detail' | 'create';
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const outsideStart = useRef(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Follow the keyboard's visible area without resizing away pinch zoom.
    const update = () => {
      const dialog = ref.current;
      if (!dialog) return;
      if (viewport.scale !== 1) return;
      dialog.dataset.compact = String(
        viewport.height <
          30 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      dialog.style.setProperty(
        '--expense-viewport-height',
        `${viewport.height}px`,
      );
      dialog.style.setProperty(
        '--expense-viewport-top',
        `${viewport.offsetTop}px`,
      );
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  const outside = (x: number, y: number) => {
    const bounds = ref.current!.getBoundingClientRect();
    return (
      x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
    );
  };
  return (
    <dialog
      className={`ledger-dialog expense-presentation expense-presentation--${kind}`}
      ref={ref}
      role={mobile && kind === 'detail' ? 'region' : 'dialog'}
      aria-modal={mobile && kind === 'detail' ? undefined : true}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => containDialogFocus(event, ref.current)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        outsideStart.current =
          event.target === event.currentTarget &&
          outside(event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          outsideStart.current &&
          event.target === event.currentTarget &&
          outside(event.clientX, event.clientY)
        ) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        outsideStart.current = false;
      }}
    >
      <header>
        <button
          className="expense-presentation-back"
          onClick={onClose}
          aria-label="Back to expenses"
        >
          <AppIcon name="back" /> Back to expenses
        </button>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <button
          className="expense-presentation-close"
          onClick={onClose}
          aria-label="Close expense"
        >
          <AppIcon name="close" />
        </button>
      </header>
      <div className="expense-presentation-content">{children}</div>
    </dialog>
  );
}
