import { describe, expect, it } from 'vitest';
import { createInput, newDraft, validate } from './draft';

const first = 'ks1:Membership:00000000-0000-4000-8000-000000000001';
const second = 'ks1:Membership:00000000-0000-4000-8000-000000000002';
const members = [
  { id: second, displayName: 'Second', canParticipate: true },
  { id: first, displayName: 'First', canParticipate: true },
];
const valid = () => ({
  ...newDraft('2028-02-29', first, members),
  description: 'Lunch',
  amount: '1.01',
});
describe('independent expense form contract', () => {
  it('counts Unicode scalars and preserves note content while trimming only contract description whitespace', () => {
    const draft = {
      ...valid(),
      description: '\t' + '🍋'.repeat(120) + '\n',
      note: '  note\n',
    };
    const input = createInput(draft, members, 'explicit-group', 'original-key');
    expect(input.description).toBe('🍋'.repeat(120));
    expect(input.note).toBe('  note\n');
    expect(input.groupId).toBe('explicit-group');
    expect(input.key).toBe('original-key');
    expect(
      validate({ ...draft, description: '🍋'.repeat(121) }, members).errors
        .description,
    ).toBeTruthy();
    expect(
      validate({ ...draft, note: '🍋'.repeat(2000) }, members).errors.note,
    ).toBeUndefined();
    expect(
      validate({ ...draft, note: '🍋'.repeat(2001) }, members).errors.note,
    ).toBeTruthy();
  });
  it('retains selected exact zero allocations and rejects incomplete or unreconciled amounts', () => {
    const draft = {
      ...valid(),
      split: 'EXACT' as const,
      exact: { [first]: '1.01', [second]: '0' },
    };
    expect(
      createInput(draft, members, 'group', 'key').exactAllocations,
    ).toEqual([
      { participantId: second, amountMinor: '0' },
      { participantId: first, amountMinor: '101' },
    ]);
    expect(
      validate({ ...draft, exact: { [first]: '1.01' } }, members).errors
        .participants,
    ).toBeTruthy();
    expect(
      validate({ ...draft, exact: { [first]: '1.00', [second]: '0' } }, members)
        .errors.participants,
    ).toBeTruthy();
  });
  it('allows payer outside selected participants and future dates but rejects ineligible and duplicate participants', () => {
    expect(
      validate(
        { ...valid(), participants: [second], date: '9999-12-31' },
        members,
      ).errors,
    ).toEqual({});
    expect(
      validate({ ...valid(), date: '2027-02-29' }, members).errors.date,
    ).toBeTruthy();
    expect(
      validate({ ...valid(), participants: [first, first] }, members).errors
        .participants,
    ).toBeTruthy();
    expect(
      validate(
        valid(),
        members.map((m) => ({ ...m, canParticipate: false })),
      ).errors.payer,
    ).toBeTruthy();
    expect(
      validate({ ...valid(), note: 'bad\u0000' }, members).errors.note,
    ).toBeTruthy();
  });
});
