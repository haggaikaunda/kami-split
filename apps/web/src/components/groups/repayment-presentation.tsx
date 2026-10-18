'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { containDialogFocus } from '../ui/primitives';
import { acquireBodyScrollLock } from '../ui/scroll-lock';
import { AppIcon } from '@/components/workspace-identity';
import styles from './repayment-presentation.module.css';

/** Presentation only: the source-owned form retains its draft and operation. */
export function RepaymentPresentation({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const outsideStart = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const release = acquireBodyScrollLock(document.body);
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>('#repayment-heading')
      ?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const update = () => {
      if (!viewport || viewport.scale !== 1) return;
      dialog.style.setProperty('--repayment-height', `${viewport.height}px`);
      dialog.style.setProperty('--repayment-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      dialog.close();
      release();
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, []);
  const outside = (x: number, y: number) => {
    const box = ref.current!.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  };
  return (
    <dialog
      ref={ref}
      data-ui="repayment-presentation"
      className={styles.presentation}
      aria-labelledby="repayment-heading"
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
        )
          onClose();
        outsideStart.current = false;
      }}
    >
      <button
        type="button"
        className={styles.close}
        data-ui="form-button"
        aria-label="Close repayment"
        onClick={onClose}
      >
        <AppIcon name="close" />
      </button>
      <div className={styles.content}>{children}</div>
    </dialog>
  );
}
