// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ExpenseFields } from './expense-fields';
import { newDraft, type Draft } from '@/lib/relay/draft';
let host: HTMLDivElement, root: Root;
const members = [{ id: 'alice', displayName: 'Alice', canParticipate: true }];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function Fields({ note = '' }: { note?: string }) {
  const [draft, setDraft] = useState<Draft>({
    ...newDraft('2026-10-11', 'alice', members),
    note,
  });
  return (
    <fieldset>
      <ExpenseFields
        draft={draft}
        members={members}
        submitted
        change={(patch) => setDraft({ ...draft, ...patch })}
      />
    </fieldset>
  );
}
it('lets an empty optional note be expanded and collapsed without submitting', async () => {
  await act(async () => root.render(<Fields />));
  const button = host.querySelector<HTMLButtonElement>(
    '[aria-controls="expense-notes"]',
  )!;
  const notes = host.querySelector<HTMLElement>('#expense-notes')!;
  expect(notes.hidden).toBe(true);
  expect(button.type).toBe('button');
  await act(async () => button.click());
  expect(notes.hidden).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await act(async () => button.click());
  expect(notes.hidden).toBe(true);
});
it('exposes saved or recovered note text without a disclosure step', async () => {
  await act(async () => root.render(<Fields note="Retained original note" />));
  expect(host.querySelector<HTMLElement>('#expense-notes')!.hidden).toBe(false);
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
    'Retained original note',
  );
});
it('exposes invalid note content and associates its validation error', async () => {
  await act(async () => root.render(<Fields note={'a'.repeat(2001)} />));
  expect(host.querySelector<HTMLElement>('#expense-notes')!.hidden).toBe(false);
  const note = host.querySelector('textarea')!;
  expect(note.getAttribute('aria-invalid')).toBe('true');
  expect(
    document.getElementById(note.getAttribute('aria-describedby')!)
      ?.textContent,
  ).toBeTruthy();
});
