// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkspaceNavigation } from './workspace-identity';
const route = vi.hoisted(() => ({ pathname: '/household/expenses' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
it('keeps canonical navigation available and current across source routes without implicit financial actions', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    for (const [pathname, current] of [
      ['/household/expenses', '/household'],
      ['/groups/source/expenses/record', '/groups'],
      ['/trips', '/trips'],
      ['/account', '/account'],
    ]) {
      route.pathname = pathname;
      act(() => root.render(<WorkspaceNavigation />));
      expect(
        Array.from(container.querySelectorAll('a')).map((a) =>
          a.getAttribute('href'),
        ),
      ).toEqual(['/household', '/groups', '/trips', '/account']);
      expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(
        1,
      );
      expect(
        container.querySelector('[aria-current="page"]')?.getAttribute('href'),
      ).toBe(current);
      expect(container.querySelector('.workspace-brand')?.textContent).toBe(
        'Kami Grow',
      );
      expect(container.querySelector('button')).toBeNull();
      expect(
        container.querySelectorAll('svg:not([aria-hidden="true"])'),
      ).toHaveLength(0);
    }
  } finally {
    act(() => root.unmount());
  }
});
