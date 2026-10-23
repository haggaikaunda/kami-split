// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { clearFinancialStorage } from '@/lib/relay/draft';
import {
  activityChoices,
  annotationError,
  beginEdit,
  changedFields,
  freezeNext,
  loadEdit,
  persistEdit,
  rebaseEdit,
  storageKey,
  type Fact,
} from './annotation-draft';
const fact = {
  sourceId: 'source',
  sourceRevision: '1',
  materialRevision: '1',
  annotationRevision: '0',
  categoryOverride: null,
  activityOverride: null,
  note: null,
  excluded: false,
  reviewed: false,
  amountMinor: '10000',
} as Fact;
beforeEach(() => sessionStorage.clear());
it('preserves actor/source ownership and frozen exact inputs and purges recovery on departure', () => {
  const draft = beginEdit('alice', fact);
  draft.draft.NOTE = '😀 private note';
  const edit = freezeNext(draft);
  persistEdit(edit);
  expect(loadEdit('alice', 'source')?.pending).toEqual(edit.pending);
  expect(loadEdit('bob', 'source')).toBeNull();
  expect(loadEdit('alice', 'other')).toBeNull();
  const raw = JSON.parse(
    sessionStorage.getItem(storageKey('alice', 'source'))!,
  );
  raw.pending.sourceId = 'other';
  sessionStorage.setItem(storageKey('alice', 'source'), JSON.stringify(raw));
  expect(() => loadEdit('alice', 'source')).toThrow();
  clearFinancialStorage();
  expect(loadEdit('alice', 'source')).toBeNull();
});
it('uses Unicode code point limits and rejects controls and sign incompatible classifications', () => {
  const edit = beginEdit('alice', fact);
  edit.draft.NOTE = '😀'.repeat(2000);
  expect(annotationError(edit, fact)).toBe('');
  edit.draft.NOTE += '😀';
  expect(annotationError(edit, fact)).toContain('2,000');
  edit.draft.NOTE = '\u0085';
  expect(annotationError(edit, fact)).toContain('control');
  edit.draft.NOTE = 'ok\n\t';
  edit.draft.ACTIVITY = 'refund';
  expect(annotationError(edit, fact)).toContain('compatible');
  expect(activityChoices('-100')).not.toContain('purchase');
  expect(activityChoices('0')).toContain('refund');
});
it('explicit conflict reapplication preserves only intended fields and adopts current values and versions for the rest', () => {
  const edit = beginEdit('alice', fact);
  edit.draft.NOTE = 'intent';
  const next = rebaseEdit(edit, {
    ...fact,
    sourceRevision: '2',
    materialRevision: '2',
    annotationRevision: '5',
    excluded: true,
  });
  expect(next.draft.NOTE).toBe('intent');
  expect(next.draft.EXCLUDED).toBe('true');
  expect(changedFields(next)).toEqual(['NOTE']);
  expect(freezeNext(next).pending).toMatchObject({
    expectedRevision: '5',
    sourceRevision: '2',
    materialRevision: '2',
  });
});

it('rejects tampered external or unrelated durable return origins', () => {
  const edit = beginEdit('alice', fact);
  edit.returnTo = {
    href: '/personal?tab=transactions',
    focus: 'transaction-source',
    scroll: 200,
  };
  persistEdit(edit);
  expect(loadEdit('alice', 'source')?.returnTo?.scroll).toBe(200);
  for (const href of [
    'https://untrusted.invalid/personal',
    '//untrusted.invalid/personal',
    '/groups?tab=transactions',
  ]) {
    sessionStorage.setItem(
      storageKey('alice', 'source'),
      JSON.stringify({ ...edit, returnTo: { ...edit.returnTo, href } }),
    );
    expect(() => loadEdit('alice', 'source')).toThrow();
  }
});
