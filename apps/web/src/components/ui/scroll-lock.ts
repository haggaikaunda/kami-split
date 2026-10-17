type ScrollLock = { owners: number; overflow: string; priority: string };
const locks = new WeakMap<HTMLElement, ScrollLock>();

/** Keep a document locked until its last modal owner releases it, in any order. */
export function acquireBodyScrollLock(body: HTMLElement): () => void {
  const lock = locks.get(body) ?? {
    owners: 0,
    overflow: body.style.getPropertyValue('overflow'),
    priority: body.style.getPropertyPriority('overflow'),
  };
  if (lock.owners === 0) locks.set(body, lock);
  lock.owners++;
  body.style.setProperty('overflow', 'hidden');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.owners !== 0) return;
    if (lock.overflow)
      body.style.setProperty('overflow', lock.overflow, lock.priority);
    else body.style.removeProperty('overflow');
    locks.delete(body);
  };
}
