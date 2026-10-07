import type { CreateGroupInput } from './__generated__/journeyGroupCreationMutation.graphql';
import { validDate, validText, groupCreationStorageKey } from './draft';
export { groupCreationStorageKey } from './draft';
export type CreationDraft = {
  name: string;
  kind: 'ORDINARY' | 'TRIP';
  destination: string;
  startDate: string;
  endDate: string;
};
export type SavedCreation = {
  version: 1;
  actor: string; // Stable Viewer ID, not provider email or selected group.
  draft: CreationDraft;
  attempt?: CreateGroupInput;
};
export function validateCreation(draft: CreationDraft) {
  const errors: Record<string, string> = {};
  const name = draft.name.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!validText(name) || [...name].length < 1 || [...name].length > 120)
    errors.name =
      'Enter a name of 1–120 characters without invalid characters.';
  if (draft.kind !== 'ORDINARY' && draft.kind !== 'TRIP')
    errors.kind = 'Choose Group or Trip.';
  if (draft.kind === 'TRIP') {
    if (!validText(draft.destination) || [...draft.destination].length > 200)
      errors.destination =
        'Use at most 200 characters without invalid characters.';
    if (!validDate(draft.startDate))
      errors.startDate = 'Enter a valid start date.';
    if (!validDate(draft.endDate)) errors.endDate = 'Enter a valid end date.';
    else if (!errors.startDate && draft.endDate < draft.startDate)
      errors.endDate = 'End date must be on or after start date.';
  }
  return { name, errors };
}
export function creationInput(
  draft: CreationDraft,
  operationKey: string,
): CreateGroupInput {
  const { name, errors } = validateCreation(draft);
  if (Object.keys(errors).length) throw new Error('INVALID');
  return {
    operationKey,
    name,
    kind: draft.kind,
    trip:
      draft.kind === 'TRIP'
        ? {
            destination: draft.destination,
            startDate: draft.startDate,
            endDate: draft.endDate,
          }
        : null,
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** Never silently replace a malformed or another actor's unresolved attempt. */
export function readCreation(actor: string): SavedCreation | undefined {
  const raw = sessionStorage.getItem(groupCreationStorageKey);
  if (!raw) return;
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.version !== 1 ||
    value.actor !== actor ||
    !object(value.draft)
  )
    throw new Error('STORAGE');
  const draft = value.draft;
  if (
    !['name', 'destination', 'startDate', 'endDate'].every(
      (k) => typeof draft[k] === 'string',
    ) ||
    !['ORDINARY', 'TRIP'].includes(String(draft.kind))
  )
    throw new Error('STORAGE');
  if (value.attempt !== undefined) {
    const a = value.attempt;
    if (
      !object(a) ||
      typeof a.operationKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        a.operationKey,
      )
    )
      throw new Error('STORAGE');
    const expected = creationInput(draft as CreationDraft, a.operationKey);
    if (
      a.name !== expected.name ||
      a.kind !== expected.kind ||
      (expected.trip
        ? !object(a.trip) ||
          a.trip.destination !== expected.trip.destination ||
          a.trip.startDate !== expected.trip.startDate ||
          a.trip.endDate !== expected.trip.endDate
        : a.trip !== null)
    )
      throw new Error('STORAGE');
    // Return only the validated canonical wire fields.
    return {
      version: 1,
      actor,
      draft: draft as CreationDraft,
      attempt: expected,
    };
  }
  return { version: 1, actor, draft: draft as CreationDraft };
}
export function saveCreation(value: SavedCreation) {
  sessionStorage.setItem(groupCreationStorageKey, JSON.stringify(value));
}
export function removeCreation() {
  sessionStorage.removeItem(groupCreationStorageKey);
}
