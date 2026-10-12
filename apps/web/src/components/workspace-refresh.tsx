'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

/** One control per network owner. Refresh never reloads the document or its drafts. */
export function WorkspaceRefresh({
  busy,
  error,
  onRefresh,
  label = 'Refresh view',
}: {
  busy: boolean;
  error?: string;
  onRefresh: () => void;
  label?: string;
}) {
  const [pull, setPull] = useState(0);
  const [requested, setRequested] = useState(false);
  const locked = useRef(false);
  const refresh = useEffectEvent(() => {
    if (busy || locked.current) return;
    locked.current = true;
    setRequested(true);
    onRefresh();
  });
  useEffect(() => {
    if (!busy) locked.current = false;
  }, [busy, error]);
  useEffect(() => {
    // Without overscroll control the browser owns its native gesture. The button
    // remains available; never run an app refresh alongside a native reload.
    const webkit =
      /AppleWebKit/.test(navigator.userAgent) &&
      !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(navigator.userAgent);
    // WebKit may report CSS support without suppressing Safari's native reload
    // (WebKit #275947). This includes iOS browsers with CriOS/FxiOS user agents.
    if (webkit || !window.CSS?.supports('overscroll-behavior-y', 'none'))
      return;
    document.documentElement.classList.add('workspace-pull-refresh');
    let start: { x: number; y: number } | undefined;
    let distance = 0;
    const cancel = () => {
      start = undefined;
      distance = 0;
      setPull(0);
    };
    const begin = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || window.scrollY > 0) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('main')) return;
      if (
        target.closest(
          'button, a, input, select, textarea, [role="dialog"], dialog, [contenteditable]',
        )
      )
        return;
      // Nested scrolling and forms own their gestures, even at the document top.
      for (
        let node: Element | null = target;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (
          node.scrollHeight > node.clientHeight &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)
        )
          return;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || window.scrollY > 0) return cancel();
      const dy = event.touches[0].clientY - start.y;
      const dx = Math.abs(event.touches[0].clientX - start.x);
      if (dy < 0 || dx > Math.max(12, dy)) return cancel();
      if (dy < 8) return;
      if (!event.cancelable) return cancel();
      event.preventDefault();
      distance = Math.min(dy, 120);
      setPull(distance);
    };
    const end = () => {
      const ready = distance >= 80;
      cancel();
      if (ready) refresh();
    };
    document.addEventListener('touchstart', begin, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    return () => {
      document.documentElement.classList.remove('workspace-pull-refresh');
      document.removeEventListener('touchstart', begin);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
    };
  }, []);
  const status = busy
    ? 'Updating…'
    : error
      ? 'Couldn’t refresh. Try again.'
      : pull >= 80
        ? 'Release to refresh'
        : pull > 0
          ? 'Pull to refresh'
          : requested
            ? 'Up to date'
            : '';
  return (
    <div className="workspace-refresh">
      <button
        type="button"
        aria-disabled={busy}
        onClick={() => {
          if (busy || locked.current) return;
          locked.current = true;
          setRequested(true);
          onRefresh();
        }}
      >
        {label}
      </button>
      <span role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
