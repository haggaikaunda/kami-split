import {
  positions,
  validateAmount,
  validateExpense,
  validDate,
} from '../ledger';
import { fixture } from './fixtures';
import { directObligations } from '../overview';
import { createEntryPreview } from './entry';
import type {
  Activity,
  Command,
  DataPort,
  DemoControls,
  Entity,
  Envelope,
  ExpenseInput,
  ExpenseRecord,
  Failure,
  Fixture,
  Outcome,
  Scenario,
} from './port';

export const CATEGORIES = [
  'Dining',
  'Groceries',
  'Accommodation',
  'Transport',
  'Activities',
  'Home',
  'Other',
] as const;
const copy = <T>(value: T): T => structuredClone(value);
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}
function expenseFields(value: ExpenseInput): ExpenseInput {
  return {
    amount: value.amount,
    currency: value.currency,
    effectiveDate: value.effectiveDate,
    payerId: value.payerId,
    participantIds: copy(value.participantIds),
    allocations: copy(value.allocations),
    split: value.split,
    category: value.category,
    tripId: value.tripId,
    description: value.description,
    note: value.note,
  };
}
export type MockOptions = {
  fixture?: Fixture;
  clock?: () => string;
  id?: (kind: string, sequence: number) => string;
  delay?: () => Promise<void>;
};
/** Session-owned instance. All access checks are simulations, not server security. */
export function createMockData(options: MockOptions = {}): {
  port: DataPort;
  demo: DemoControls;
} {
  const clock = options.clock ?? (() => '2026-09-20T12:00:00.000Z');
  const id = options.id ?? ((kind, sequence) => `${kind}-session-${sequence}`);
  let state = fixture(options.fixture ?? 'sample', clock().slice(0, 10));
  let scenario: Scenario = 'normal';
  let serial = 0;
  let epoch = 0;
  let entryAllowed = true;
  const listeners = new Set<() => void>();
  const operations = new Map<
    string,
    { fingerprint: string; result: Outcome<Entity>; selfRemoval: boolean }
  >();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot roll back an already committed command. */
      }
    }
  };
  const access = (
    householdId: string,
    actorId = state.actorId,
  ): Failure | null => {
    if (scenario === 'expired') return { status: 'expired' };
    if (
      !entryAllowed ||
      scenario === 'denied' ||
      householdId !== state.household.id ||
      actorId !== state.actorId ||
      !state.members.some(
        (member) => member.id === actorId && member.status === 'active',
      )
    )
      return { status: 'denied' };
    return null;
  };
  async function pause(mode: Scenario) {
    if (mode === 'slow')
      await (options.delay?.() ??
        new Promise((resolve) => setTimeout(resolve, 600)));
  }
  const validation = (fields: Record<string, string>): Failure => ({
    status: 'validation',
    fields,
  });
  function validateInput(
    value: ExpenseInput,
    recordId: string,
    previous?: ExpenseRecord,
  ): Failure | null {
    const fields: Record<string, string> = {};
    if (
      typeof value.description !== 'string' ||
      !value.description.trim() ||
      value.description.trim().length > 120
    )
      fields.description = 'Enter a description of 1–120 characters.';
    if (value.currency !== 'USD')
      fields.currency = 'Only USD is enabled in this demo.';
    if (!validDate(value.effectiveDate))
      fields.effectiveDate = 'Enter a valid date.';
    if (!CATEGORIES.includes(value.category as (typeof CATEGORIES)[number]))
      fields.category = 'Select a category.';
    if (
      value.tripId !== null &&
      !state.trips.some((trip) => trip.id === value.tripId)
    )
      fields.tripId = 'Select an available trip.';
    if (typeof value.note !== 'string' || value.note.length > 2000)
      fields.note = 'Use at most 2,000 characters.';
    const active = state.members
      .filter((member) => member.status === 'active')
      .map((member) => member.id);
    const historic = previous
      ? [previous.payerId, ...previous.participantIds]
      : [];
    const allowed = [...new Set([...active, ...historic])];
    try {
      validateExpense({ ...value, id: recordId }, allowed);
    } catch (error) {
      fields.allocations =
        error instanceof Error ? error.message : 'Check amount and allocation.';
    }
    return Object.keys(fields).length ? validation(fields) : null;
  }
  function commit(command: Command, actorId: string): Outcome<Entity> {
    const next = copy(state);
    let nextSerial = serial;
    const nextId = (kind: string) => id(kind, ++nextSerial);
    const at = clock();
    let entity: Entity;
    const event = (
      kind: Activity['kind'],
      snapshot: Activity['snapshot'],
      revisionId?: string,
    ) =>
      next.activity.push({
        id: nextId('event'),
        sequence: next.activity.length + 1,
        at,
        actorId,
        kind,
        recordId: snapshot.id,
        revisionId,
        snapshot: copy(snapshot),
      });
    const revision = (
      row: ExpenseRecord,
      kind: 'created' | 'edited' | 'deleted',
      reason = '',
    ) => {
      const revisionId = nextId('revision');
      next.revisions.push({
        id: revisionId,
        expenseId: row.id,
        version: row.version,
        actorId,
        at,
        reason,
        snapshot: copy(row),
      });
      event(kind, row, revisionId);
    };
    if (
      command.kind === 'create-expense' ||
      command.kind === 'update-expense' ||
      command.kind === 'delete-expense'
    ) {
      const previous =
        command.kind === 'create-expense'
          ? undefined
          : next.expenses.find((row) => row.id === command.id);
      if (command.kind !== 'create-expense') {
        if (!previous) return { status: 'unavailable' };
        if (previous.deleted)
          return { status: 'deleted', current: copy(previous) };
        if (previous.version !== command.expectedVersion)
          return { status: 'conflict', current: copy(previous) };
      }
      if (command.kind === 'delete-expense') {
        if (typeof command.reason !== 'string' || command.reason.length > 2000)
          return validation({ reason: 'Use at most 2,000 characters.' });
        const row = {
          ...previous!,
          deleted: true,
          version: previous!.version + 1,
          updatedAt: at,
        };
        next.expenses = next.expenses.map((item) =>
          item.id === row.id ? row : item,
        );
        revision(row, 'deleted', command.reason);
        entity = row;
      } else {
        const recordId = previous?.id ?? nextId('expense');
        const failure = validateInput(command.value, recordId, previous);
        if (failure) return failure;
        const row: ExpenseRecord = {
          ...expenseFields(command.value),
          description: command.value.description.trim(),
          id: recordId,
          creatorId: previous?.creatorId ?? actorId,
          createdAt: previous?.createdAt ?? at,
          updatedAt: at,
          version: (previous?.version ?? 0) + 1,
        };
        if (previous)
          next.expenses = next.expenses.map((item) =>
            item.id === row.id ? row : item,
          );
        else next.expenses.push(row);
        revision(row, previous ? 'edited' : 'created');
        entity = row;
      }
    } else if (command.kind === 'record-repayment') {
      const value = command.value;
      const fields: Record<string, string> = {};
      try {
        validateAmount(value.amount);
      } catch {
        fields.amount = 'Enter a positive amount within the supported range.';
      }
      if (value.currency !== 'USD')
        fields.currency = 'Only USD is enabled in this demo.';
      if (!validDate(value.effectiveDate))
        fields.effectiveDate = 'Enter a valid date.';
      if (
        value.senderId === value.recipientId ||
        ![value.senderId, value.recipientId].every((memberId) =>
          next.members.some(
            (member) => member.id === memberId && member.status === 'active',
          ),
        )
      )
        fields.recipientId = 'Choose two distinct active members.';
      if (typeof value.note !== 'string' || value.note.length > 2000)
        fields.note = 'Use at most 2,000 characters.';
      if (Object.keys(fields).length) return validation(fields);
      const row = {
        id: nextId('repayment'),
        amount: value.amount,
        currency: value.currency,
        senderId: value.senderId,
        recipientId: value.recipientId,
        effectiveDate: value.effectiveDate,
        note: value.note,
        creatorId: actorId,
        createdAt: at,
      };
      next.repayments.push(row);
      event('repayment', row);
      entity = row;
    } else if (command.kind === 'create-trip') {
      const value = command.value;
      const fields: Record<string, string> = {};
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.trim().length > 120
      )
        fields.name = 'Enter a name of 1–120 characters.';
      if (!validDate(value.start)) fields.start = 'Enter a valid start date.';
      if (!validDate(value.end) || value.end < value.start)
        fields.end = 'End date must be on or after the start.';
      if (
        typeof value.destination !== 'string' ||
        value.destination.length > 200
      )
        fields.destination = 'Use at most 200 characters.';
      if (Object.keys(fields).length) return validation(fields);
      const row = {
        id: nextId('trip'),
        name: value.name.trim(),
        destination: value.destination,
        start: value.start,
        end: value.end,
        cover: null,
      };
      next.trips.push(row);
      entity = row;
    } else if (command.kind === 'update-household') {
      if (
        !next.members.some(
          (member) => member.id === actorId && member.role === 'owner',
        )
      )
        return { status: 'denied' };
      if (
        typeof command.name !== 'string' ||
        !command.name.trim() ||
        command.name.length > 120
      )
        return validation({
          name: 'Enter a household name of 1–120 characters.',
        });
      next.household = { ...next.household, name: command.name.trim() };
      entity = next.household;
    } else {
      const actor = next.members.find((member) => member.id === actorId)!;
      const selfRemoval =
        command.kind === 'remove-member' && command.memberId === actorId;
      if (actor.role !== 'owner' && !selfRemoval) return { status: 'denied' };
      if (command.kind === 'invite-member') {
        if (
          typeof command.name !== 'string' ||
          !command.name.trim() ||
          command.name.trim().length > 80
        )
          return validation({
            name: 'Enter a preview name of 1–80 characters.',
          });
        if (
          next.members.some(
            (member) =>
              member.status !== 'inactive' &&
              member.name.toLowerCase() === command.name.trim().toLowerCase(),
          )
        )
          return validation({
            name: 'This active or invited member already exists.',
          });
        const member = {
          id: nextId('member'),
          name: command.name.trim(),
          role: 'member' as const,
          status: 'pending' as const,
          invitationAttempts: 1,
        };
        next.members.push(member);
        entity = member;
      } else {
        const member = next.members.find(
          (member) => member.id === command.memberId,
        );
        if (!member) return { status: 'unavailable' };
        if (
          command.kind === 'resend-invite' ||
          command.kind === 'revoke-invite'
        ) {
          if (member.status !== 'pending')
            return validation({
              member:
                'This invitation is no longer pending. Refresh the member list.',
            });
          if (command.kind === 'resend-invite')
            member.invitationAttempts = (member.invitationAttempts ?? 1) + 1;
          else member.status = 'inactive';
        } else {
          if (member.status !== 'active')
            return validation({ member: 'Choose an active member.' });
          const losesOwnership =
            member.role === 'owner' &&
            (command.kind === 'remove-member' ||
              (command.kind === 'change-role' && command.role === 'member'));
          if (
            losesOwnership &&
            next.members.filter(
              (row) => row.status === 'active' && row.role === 'owner',
            ).length <= 1
          )
            return validation({
              member:
                'The last owner cannot leave or lose ownership. Make another active member an owner first.',
            });
          if (command.kind === 'remove-member') {
            for (const currency of ['USD', 'EUR'] as const) {
              const balance = positions(
                next.members.map((row) => row.id),
                next.expenses,
                next.repayments,
                currency,
              ).find((row) => row.memberId === member.id);
              if (
                balance?.net ||
                directObligations(next, currency).some(
                  (edge) =>
                    edge.senderId === member.id ||
                    edge.recipientId === member.id,
                )
              )
                return validation({
                  member:
                    'A member with an outstanding balance cannot be removed. Settle their balance first.',
                });
            }
            member.status = 'inactive';
          } else if (command.kind === 'change-role') {
            if (command.role !== 'owner' && command.role !== 'member')
              return validation({ role: 'Choose owner or member.' });
            member.role = command.role;
          }
        }
        entity = member;
      }
    }
    // Removed members have no remaining obligations. Historical corrections must
    // not reopen debt they can no longer settle through the active-member flow.
    if (
      command.kind === 'create-expense' ||
      command.kind === 'update-expense' ||
      command.kind === 'delete-expense'
    ) {
      const inactive = new Set(
        next.members
          .filter((member) => member.status === 'inactive')
          .map((member) => member.id),
      );
      if (
        inactive.size &&
        (['USD', 'EUR'] as const).some((currency) =>
          directObligations(next, currency).some(
            (edge) =>
              inactive.has(edge.senderId) || inactive.has(edge.recipientId),
          ),
        )
      )
        return validation({
          allocations:
            'This change would reopen a balance for an inactive member. Keep their historical financial amounts unchanged. Notes and other nonfinancial corrections are still allowed.',
        });
    }
    // Validate aggregate conservation before swapping the complete session state.
    positions(
      next.members.map((member) => member.id),
      next.expenses,
      next.repayments,
      'USD',
    );
    next.generation++;
    state = next;
    serial = nextSerial;
    return { status: 'ok', value: copy(entity) };
  }
  const entry = createEntryPreview({
    deny() {
      entryAllowed = false;
    },
    existing() {
      entryAllowed = true;
      scenario = 'normal';
      const actorId = state.members.some(
        (member) => member.id === state.actorId && member.status === 'active',
      )
        ? state.actorId
        : (state.members.find((member) => member.status === 'active')?.id ??
          'member-k');
      state = { ...state, actorId, generation: state.generation + 1 };
    },
    invitation() {
      const pending = state.members.find(
        (member) => member.status === 'pending',
      );
      return {
        inviteeId: pending?.id ?? 'member-invited',
        inviteeName: pending?.name ?? 'Alex (preview)',
      };
    },
    invite(memberId = 'member-invited') {
      const existing = state.members.find((member) => member.id === memberId);
      if (existing?.status === 'inactive') return false;
      if (existing) existing.status = 'active';
      else if (memberId === 'member-invited')
        state.members.push({
          id: memberId,
          name: 'Alex (preview)',
          role: 'member',
          status: 'active',
        });
      else return false;
      entryAllowed = true;
      scenario = 'normal';
      state = { ...state, actorId: memberId, generation: state.generation + 1 };
      return true;
    },
    setup() {
      entryAllowed = false;
    },
    completeSetup(name) {
      epoch++;
      operations.clear();
      const fresh = fixture('empty', clock().slice(0, 10));
      const householdId = `household-setup-${epoch}`;
      state = {
        ...fresh,
        trips: [],
        household: { ...fresh.household, id: householdId, name },
        members: [fresh.members.find((member) => member.id === 'member-k')!],
        actorId: 'member-k',
        generation: state.generation + 1,
      };
      entryAllowed = true;
      scenario = 'normal';
      return householdId;
    },
    notify,
  });
  const port: DataPort = {
    entry: entry.port,
    async read(householdId) {
      const requestEpoch = epoch,
        actorId = state.actorId;
      await pause(scenario);
      const failure = access(householdId, actorId);
      if (failure) return failure;
      if (requestEpoch !== epoch) return { status: 'unavailable' };
      if (scenario === 'offline') return { status: 'offline' };
      const snapshot = copy(state);
      snapshot.activity.sort(
        (a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence,
      );
      return { status: 'ok', value: snapshot };
    },
    async expense(householdId, recordId, version) {
      const result = await port.read(householdId);
      if (result.status !== 'ok') return result;
      const row =
        version === undefined
          ? result.value.expenses.find((item) => item.id === recordId)
          : result.value.revisions.find(
              (item) => item.expenseId === recordId && item.version === version,
            )?.snapshot;
      return row ? { status: 'ok', value: row } : { status: 'unavailable' };
    },
    async execute(input: Envelope) {
      const envelope = copy(input),
        actorId = state.actorId,
        requestEpoch = epoch,
        mode = scenario;
      const initialAccess = access(envelope.householdId, actorId);
      if (initialAccess) return initialAccess;
      if (!envelope.operationId.trim())
        return validation({ operationId: 'Operation ID is required.' });
      if (
        [
          'offline',
          'timeout-after-commit',
          'second-editor',
          'concurrent-delete',
        ].includes(mode)
      )
        scenario = 'normal';
      await pause(mode);
      const failure = access(envelope.householdId, actorId);
      if (failure) return failure;
      if (requestEpoch !== epoch) return { status: 'unavailable' };
      const key = `${envelope.householdId}:${actorId}:${envelope.operationId}`;
      const fingerprint = canonical(envelope.command);
      const previous = operations.get(key);
      if (previous)
        return previous.fingerprint === fingerprint
          ? copy(previous.result)
          : { status: 'operation-conflict' };
      if (mode === 'offline') return { status: 'offline' };
      const command = envelope.command;
      if (
        (mode === 'second-editor' || mode === 'concurrent-delete') &&
        (command.kind === 'update-expense' || command.kind === 'delete-expense')
      ) {
        const current = state.expenses.find((row) => row.id === command.id);
        if (current && !current.deleted) {
          const other =
            state.members.find(
              (member) => member.id !== actorId && member.status === 'active',
            )?.id ?? actorId;
          commit(
            mode === 'concurrent-delete'
              ? {
                  kind: 'delete-expense',
                  id: current.id,
                  expectedVersion: current.version,
                  reason: 'Simulated concurrent deletion',
                }
              : {
                  kind: 'update-expense',
                  id: current.id,
                  expectedVersion: current.version,
                  value: {
                    ...current,
                    note: 'Updated by the simulated second editor',
                  },
                },
            other,
          );
        }
      }
      let result: Outcome<Entity>;
      try {
        result = commit(command, actorId);
      } catch {
        result = validation({
          amount: 'The ledger cannot safely accept these values.',
        });
      }
      // Only completed commands bind an operation ID. Rejected validation/conflicts can be corrected.
      if (result.status === 'ok')
        operations.set(key, {
          fingerprint,
          result: copy(result),
          selfRemoval:
            command.kind === 'remove-member' && command.memberId === actorId,
        });
      notify();
      return mode === 'timeout-after-commit' && result.status === 'ok'
        ? { status: 'unknown' }
        : copy(result);
    },
    async operation(householdId, operationId) {
      const failure = access(householdId);
      if (failure) {
        const receipt = operations.get(
          `${householdId}:${state.actorId}:${operationId}`,
        );
        if (
          failure.status === 'denied' &&
          entryAllowed &&
          scenario !== 'denied' &&
          scenario !== 'offline' &&
          householdId === state.household.id &&
          receipt?.selfRemoval
        )
          return copy(receipt.result);
        return failure;
      }
      if (scenario === 'offline') return { status: 'offline' };
      const entry = operations.get(
        `${householdId}:${state.actorId}:${operationId}`,
      );
      return entry ? copy(entry.result) : { status: 'not-started' };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    demo: {
      scenario(value) {
        scenario = value;
        notify();
      },
      actor(memberId) {
        state = {
          ...state,
          actorId: memberId,
          generation: state.generation + 1,
        };
        notify();
      },
      reset(name = 'sample') {
        entryAllowed = true;
        entry.reset();
        epoch++;
        serial = 0;
        operations.clear();
        scenario = 'normal';
        state = fixture(name, clock().slice(0, 10));
        notify();
      },
    },
  };
}
