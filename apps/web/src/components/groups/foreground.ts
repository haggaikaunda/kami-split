import { useEffect, useEffectEvent } from 'react';
/** Hide synchronously on every foreground event, then start one read after the
 * event burst. No pre-event request is reused as the refreshed authorization. */
export function useForegroundRefresh(
  invalidate: () => void,
  refresh: () => void,
  enabled = true,
) {
  const hide = useEffectEvent(invalidate);
  const read = useEffectEvent(refresh);
  useEffect(() => {
    if (!enabled) return;
    let frame: number | undefined;
    const foreground = () => {
      if (document.visibilityState !== 'visible') return;
      hide();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        read();
      });
    };
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [enabled]);
}
