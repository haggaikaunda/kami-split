'use client';
import { useEffect } from 'react';

/** Only a real pointer identifies pointer presentation. Clicks from keyboard,
 * assistive technology or scripts leave the browser's focus indication intact. */
export function FocusInput() {
  useEffect(() => {
    const root = document.documentElement;
    let pendingPointer: EventTarget | null = null;
    const clear = () => {
      pendingPointer = null;
      delete root.dataset.focusInput;
    };
    const pointer = (event: PointerEvent) => {
      if (event.isTrusted && event.pointerType) {
        pendingPointer = event.target;
        root.dataset.focusInput = 'pointer';
      } else clear();
    };
    const click = (event: MouseEvent) => {
      const fromPointer =
        event.isTrusted &&
        event.detail > 0 &&
        pendingPointer &&
        event.composedPath().includes(pendingPointer);
      pendingPointer = null;
      if (!fromPointer) clear();
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('pointercancel', clear, true);
    document.addEventListener('keydown', clear, true);
    document.addEventListener('click', click, true);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('pointercancel', clear, true);
      document.removeEventListener('keydown', clear, true);
      document.removeEventListener('click', click, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return null;
}
