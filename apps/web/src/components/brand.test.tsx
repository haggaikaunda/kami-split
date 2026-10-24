// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Brand } from './brand';

it('renders public branding without session providers, links or duplicate accessible text', () => {
  const html = renderToStaticMarkup(<Brand />);
  const host = document.createElement('div');
  host.innerHTML = html;
  expect(host.textContent).toBe('Kami Grow');
  expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  expect(host.querySelector('title, [role="img"], a, button')).toBeNull();
});

it('leaves a containing brand link with one live name and native keyboard semantics', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <a href="/sign-in">
          <Brand />
        </a>,
      ),
    );
    const link = host.querySelector('a')!;
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.textContent).toBe('Kami Grow');
    expect(link.getAttribute('href')).toBe('/sign-in');
    expect(host.querySelectorAll('[tabindex]')).toHaveLength(0);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
