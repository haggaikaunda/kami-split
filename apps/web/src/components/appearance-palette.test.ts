import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the approved Dark palette behind the explicit appearance selector', () => {
  const css = readFileSync(
    new URL('../app/styles.css', import.meta.url),
    'utf8',
  );
  const dark = css.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)?.[1];
  expect(dark).toBeDefined();
  const expected = {
    canvas: '#0b111a',
    surface: '#121a27',
    'surface-raised': '#172131',
    'surface-accent': '#142a2c',
    separator: '#334153',
    ink: '#f7f9fc',
    muted: '#aebacf',
    primary: '#58efb7',
    'primary-surface': '#173c37',
    indigo: '#9aa8ff',
    'indigo-surface': '#202b47',
    'warm-surface': '#fff1df',
    'warm-ink': '#b66a2b',
  };
  for (const [token, value] of Object.entries(expected)) {
    expect(dark?.toLowerCase()).toContain(`--color-${token}: ${value};`);
  }
  const account = readFileSync(
    new URL('./onboarding/onboarding.css', import.meta.url),
    'utf8',
  );
  expect(css + account).not.toContain('prefers-color-scheme');
});
