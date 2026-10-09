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

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it.each(['light', 'dark'])(
  'keeps %s semantic text and action pairs readable',
  (theme) => {
    const css = readFileSync(
      new URL('../app/styles.css', import.meta.url),
      'utf8',
    );
    const root = css.match(/:root\s*\{([^}]+)\}/)![1];
    const dark = css.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)![1];
    const tokens = Object.fromEntries(
      [
        ...`${root}${theme === 'dark' ? dark : ''}`.matchAll(
          /--color-([\w-]+):\s*([^;]+);/g,
        ),
      ].map((match) => [match[1], match[2].trim()]),
    );
    const resolve = (name: string): string => {
      const value = tokens[name];
      const reference = value.match(/^var\(--color-([\w-]+)\)$/);
      return reference ? resolve(reference[1]) : value;
    };
    const pairs = [
      ['ink', 'surface'],
      ['muted', 'surface'],
      ['muted', 'canvas'],
      ['on-primary', 'primary'],
      ['danger', 'error-surface'],
      ['on-summary', 'summary-total'],
      ['summary-muted', 'summary-total'],
      ['on-summary', 'summary-net'],
      ['summary-muted', 'summary-net'],
      ['on-summary', 'summary-share'],
      ['summary-muted', 'summary-share'],
      ['info', 'info-surface'],
      ['accent', 'accent-surface'],
    ];
    for (const category of [
      'dining',
      'groceries',
      'accommodation',
      'transport',
      'activities',
      'home',
      'other',
    ]) {
      pairs.push([`category-${category}`, `category-${category}-surface`]);
    }
    for (const [foreground, background] of pairs) {
      const levels = [
        luminance(resolve(foreground)),
        luminance(resolve(background)),
      ].sort((a, b) => a - b);
      expect(
        (levels[1] + 0.05) / (levels[0] + 0.05),
        `${theme}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);
