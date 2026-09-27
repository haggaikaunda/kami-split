import { describe, expect, it } from 'vitest';
import {
  expenseHref,
  fullPageHref,
  presentation,
  sourceDescriptor,
} from './session';

describe('independent navigation descriptor acceptance probes', () => {
  it('stores separate serializable origins for repeated visits to the same opaque record', () => {
    const scroll = { x: 0, y: 920 };
    const first = sourceDescriptor(
      '/history?category=Dining&sort=oldest',
      'history-entry',
      'history-record',
      scroll,
      'visit-one',
    );
    const second = sourceDescriptor(
      '/trips/maui?tab=expenses&search=Coffee',
      'trip-entry',
      'trip-record',
      { x: 0, y: 150 },
      'visit-two',
    );
    scroll.y = 0;
    expect(first.scroll.y).toBe(920);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.entryId).not.toBe(second.entryId);
    expect(expenseHref('record / with ? chars', first.visitId)).not.toBe(
      expenseHref('record / with ? chars', second.visitId),
    );
    expect(
      new URL(
        expenseHref('record / with ? chars', first.visitId),
        'https://kami.invalid',
      ).pathname,
    ).toBe('/expenses/record%20%2F%20with%20%3F%20chars');
  });

  it('full-page presentation preserves visit identity and other route parameters', () => {
    const href = '/expenses/same-id?visit=visit-one&mode=preview';
    const full = new URL(fullPageHref(href), 'https://kami.invalid');
    expect(full.pathname).toBe('/expenses/same-id');
    expect(full.searchParams.get('visit')).toBe('visit-one');
    expect(full.searchParams.get('mode')).toBe('preview');
    expect(full.searchParams.get('view')).toBe('full');
    expect(fullPageHref(fullPageHref(href))).toBe(fullPageHref(href));
  });

  it('uses full-page presentation at the exact 760px boundary and for every direct or forced visit', () => {
    for (const width of [320, 390, 759, 760])
      expect(presentation(true, width, false)).toBe('page');
    for (const width of [761, 1280])
      expect(presentation(true, width, false)).toBe('panel');
    for (const width of [320, 760, 761, 1280]) {
      expect(presentation(false, width, false)).toBe('page');
      expect(presentation(true, width, true)).toBe('page');
    }
  });
});
