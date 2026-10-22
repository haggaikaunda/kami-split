// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkspaceNavigation } from './workspace-identity';
import { CategoryIcon } from '@/components/financial/category';
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
      ['/trips', '/groups'],
      ['/trips/summer', '/groups'],
      ['/account', '/account'],
      ['/personal', '/personal'],
      ['/personal/transactions', '/personal'],
    ]) {
      route.pathname = pathname;
      act(() => root.render(<WorkspaceNavigation />));
      expect(
        Array.from(container.querySelectorAll('a')).map((a) =>
          a.getAttribute('href'),
        ),
      ).toEqual([
        '/household',
        '/personal',
        '/groups',
        '/household/expenses?create=choose',
        '/account',
      ]);
      expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(
        1,
      );
      expect(
        container.querySelector('[aria-current="page"]')?.getAttribute('href'),
      ).toBe(current);
      expect(
        container.querySelector('[data-ui~="workspace-brand"]')?.textContent,
      ).toBe('Kami Grow');
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelectorAll('a[href="/account"]')).toHaveLength(1);
      expect(
        container.querySelector('[aria-label="Add expense"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-ui="workspace-add-slot"]')?.textContent,
      ).toContain('Expense');
      expect(
        container.querySelectorAll('svg:not([aria-hidden="true"])'),
      ).toHaveLength(0);
    }
  } finally {
    act(() => root.unmount());
  }
});

it('retains accessible category identity when compact rows hide category text', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<CategoryIcon category="GROCERIES" />));
    expect(
      container.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe('groceries');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  } finally {
    act(() => root.unmount());
  }
});

it('keeps keyboard DOM order aligned with each layout while preserving the mounted action slot', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<WorkspaceNavigation />));
    const slot = container.querySelector('[data-ui="workspace-add-slot"]');
    for (const pixels of [320, 600, 601, 1440, 390]) {
      width.mockReturnValue(pixels);
      act(() => window.dispatchEvent(new Event('resize')));
      expect(
        [...container.querySelectorAll('a')].map((link) =>
          link.getAttribute('href'),
        ),
      ).toEqual(
        pixels <= 600
          ? [
              '/household',
              '/personal',
              '/household/expenses?create=choose',
              '/groups',
              '/account',
            ]
          : [
              '/household',
              '/personal',
              '/groups',
              '/household/expenses?create=choose',
              '/account',
            ],
      );
      expect(container.querySelector('[data-ui="workspace-add-slot"]')).toBe(
        slot,
      );
    }
  } finally {
    act(() => root.unmount());
    width.mockRestore();
  }
});
