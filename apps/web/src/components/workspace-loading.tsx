'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Retain only geometry while private content is replaced by a fresh-read skeleton. */
export function WorkspaceLoading({
  busy,
  children,
  className = '',
}: {
  busy: boolean;
  children: ReactNode;
  className?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    node.style.minHeight = busy && height.current ? `${height.current}px` : '';
    if (busy) return;
    const measure = () => {
      height.current = node.getBoundingClientRect().height;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [busy]);
  return (
    <div ref={element} className={`workspace-loading-surface ${className}`}>
      {children}
    </div>
  );
}
