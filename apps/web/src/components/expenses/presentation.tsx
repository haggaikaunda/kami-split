'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { containDialogFocus } from '../ui/primitives';
import { acquireBodyScrollLock } from '../ui/scroll-lock';

import { AppIcon } from '@/components/workspace-identity';
import { cx } from '../ui/classnames';

import focusStyles from '../ui/focus.module.css';
import formLayoutStyles from '../ui/form-layout.module.css';
import dialogFeatureStyles from './dialog.module.css';
import presentationFeatureStyles from './presentation.module.css';

/** One mounted presentation preserves form drafts across responsive changes. */
export function ExpensePresentation({
  title,
  kind = 'detail',
  layout = 'group',
  onClose,
  children,
  restoreFocus = true,
}: {
  /** Ledger owns its authorized deferred return; other consumers restore here. */
  restoreFocus?: boolean;
  title: string;
  kind?: 'detail' | 'create';
  layout?: 'group' | 'household';
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
    const releaseScroll = acquireBodyScrollLock(document.body);
    dialog.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      releaseScroll();
      if (
        restoreFocus &&
        trigger?.isConnected &&
        !document.querySelector('dialog[open]')
      )
        trigger.focus({ preventScroll: true });
    };
  }, [restoreFocus]);
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
      data-ui={`form-scope ledger-dialog expense-presentation expense-presentation--${kind}`}
      className={cx(
        formLayoutStyles['form-scope'],
        dialogFeatureStyles['ledger-dialog'],
        presentationFeatureStyles['expense-presentation'],
        presentationFeatureStyles[`expense-presentation--${kind}`],
      )}
      data-layout={layout}
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
      <header data-ui="form-region">
        <button
          data-ui="expense-presentation-back form-button"
          className={cx(
            presentationFeatureStyles['expense-presentation-back'],
            focusStyles['pointer-focus'],
          )}
          onClick={onClose}
          aria-label="Back to expenses"
        >
          <AppIcon name="back" /> Back to expenses
        </button>
        <h1
          ref={heading}
          tabIndex={-1}
          className={focusStyles['pointer-focus']}
        >
          {title}
        </h1>
        <button
          data-ui="expense-presentation-close form-button"
          className={cx(
            presentationFeatureStyles['expense-presentation-close'],
            focusStyles['pointer-focus'],
          )}
          onClick={onClose}
          aria-label="Close expense"
        >
          <AppIcon name="close" />
        </button>
      </header>
      <div
        data-ui="expense-presentation-content"
        className={presentationFeatureStyles['expense-presentation-content']}
      >
        {children}
      </div>
    </dialog>
  );
}
