// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  creationInput,
  readCreation,
  saveCreation,
  validateCreation,
  groupCreationStorageKey,
  type CreationDraft,
} from './group-creation';
import { clearFinancialStorage } from './draft';
const draft: CreationDraft = {
  name: ' \tTrip\r\n',
  kind: 'TRIP',
  destination: '  Tokyo  ',
  startDate: '0001-01-01',
  endDate: '9999-12-31',
};
beforeEach(() => sessionStorage.clear());
it('canonicalizes ASCII name only, retains destination, and sends no actor/currency/member fields', () => {
  expect(creationInput(draft, 'key')).toEqual({
    operationKey: 'key',
    name: 'Trip',
    kind: 'TRIP',
    trip: {
      destination: '  Tokyo  ',
      startDate: '0001-01-01',
      endDate: '9999-12-31',
    },
  });
  expect(creationInput({ ...draft, kind: 'ORDINARY' }, 'key').trip).toBeNull();
  expect(
    creationInput({ ...draft, name: '\u00a0Name\u00a0' }, 'key').name,
  ).toBe('\u00a0Name\u00a0');
});
it('counts Unicode scalars, rejects NUL/surrogates, and enforces Gregorian ordered dates', () => {
  expect(
    validateCreation({
      ...draft,
      name: '😀'.repeat(120),
      destination: '😀'.repeat(200),
    }).errors,
  ).toEqual({});
  for (const name of ['', ' \t\r\n', '😀'.repeat(121), '\ud800', 'N\0'])
    expect(validateCreation({ ...draft, name }).errors.name).toBeTruthy();
  for (const destination of ['😀'.repeat(201), '\udfff', '\0'])
    expect(
      validateCreation({ ...draft, destination }).errors.destination,
    ).toBeTruthy();
  for (const startDate of [
    '0000-01-01',
    '2025-02-29',
    '2024-04-31',
    '2026-1-01',
  ])
    expect(
      validateCreation({ ...draft, startDate }).errors.startDate,
    ).toBeTruthy();
  expect(
    validateCreation({
      ...draft,
      startDate: '2024-02-29',
      endDate: '2024-02-29',
    }).errors,
  ).toEqual({});
  expect(
    validateCreation({
      ...draft,
      startDate: '2024-03-01',
      endDate: '2024-02-29',
    }).errors.endDate,
  ).toBeTruthy();
});
it('retains canonical identity-scoped attempts and fails closed on corruption or different actor', () => {
  const attempt = creationInput(draft, crypto.randomUUID());
  saveCreation({ version: 1, actor: 'Viewer:A', draft, attempt });
  expect(readCreation('Viewer:A')?.attempt).toEqual(attempt);
  expect(() => readCreation('Viewer:B')).toThrow();
  const raw = JSON.parse(sessionStorage.getItem(groupCreationStorageKey)!);
  raw.attempt.trip.destination = 'changed';
  sessionStorage.setItem(groupCreationStorageKey, JSON.stringify(raw));
  expect(() => readCreation('Viewer:A')).toThrow();
  clearFinancialStorage();
  expect(readCreation('Viewer:A')).toBeUndefined();
});
