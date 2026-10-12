import { act } from 'react';
/** Exercise the existing foreground authorization boundary without an in-app button. */
export async function foregroundRefresh() {
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
/** Dispatch a complete deliberate pull after browser capability setup. */
export function pullRefresh(target: Element) {
  for (const [type, y, count] of [
    ['touchstart', 0, 1],
    ['touchmove', 100, 1],
    ['touchend', 100, 0],
  ] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: Array.from({ length: count }, () => ({ clientX: 20, clientY: y })),
    });
    target.dispatchEvent(event);
  }
}
