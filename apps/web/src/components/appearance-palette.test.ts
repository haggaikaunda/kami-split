import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the approved Dark palette behind the explicit appearance selector', () => {
  const css = readFileSync(
    new URL('../app/tokens.css', import.meta.url),
    'utf8',
  );
  const dark = css.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)?.[1];
  expect(dark).toBeDefined();
  // Approved #227 final source cascade; the former #225 palette was superseded.
  const expected = {
    canvas: '#0b111b',
    surface: '#131d2c',
    subtle: '#192535',
    high: '#24364a',
    chrome: '#101927',
    separator: '#2a394c',
    ink: '#f5f7ff',
    muted: '#afbed1',
    primary: '#50e1b4',
    container: '#163c35',
    'on-container': '#79f0cb',
    border: '#7d90a7',
    violet: '#aaa2ff',
    blue: '#7cbdff',
    orange: '#ffc27e',
    coral: '#ff9ca8',
    'summary-total': '#182436',
    'summary-net': '#173631',
    'summary-share': '#222b40',
    'share-icon': '#ffc77c',
    'chart-cyan': '#75d1dc',
    'chart-label': '#102434',
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
      new URL('../app/tokens.css', import.meta.url),
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
      ['blue', 'blue-surface'],
      ['violet', 'violet-surface'],
    ];
    // Test the concrete roles consumed by category styles, including the
    // chart's cyan/neutral hues; the unused category aliases no longer own them.
    const graphicalPairs = [
      ['coral', 'coral-surface'],
      ['primary', 'green-surface'],
      ['violet', 'violet-surface'],
      ['chart-cyan', 'blue-surface'],
      ['orange', 'orange-surface'],
      ['blue', 'blue-surface'],
      ['muted', 'violet-surface'],
    ];
    // Category hues paint icons/segments, not body text. Exact amounts and
    // category names use the high-contrast legend. Graphical objects require 3:1.
    for (const [foreground, background, minimum] of [
      ...pairs.map(([f, b]) => [f, b, 4.5] as const),
      ...graphicalPairs.map(([f, b]) => [f, b, 3] as const),
    ]) {
      const levels = [
        luminance(resolve(foreground)),
        luminance(resolve(background)),
      ].sort((a, b) => a - b);
      expect(
        (levels[1] + 0.05) / (levels[0] + 0.05),
        `${theme}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  },
);
