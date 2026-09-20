import type { Expense, Repayment } from '../ledger';

export type Member = {
  id: string;
  name: string;
  role: 'owner' | 'member';
  status: 'active' | 'pending' | 'inactive';
};
export type Household = { id: string; name: string; currency: 'USD' };
export type Trip = {
  id: string;
  name: string;
  destination: string;
  start: string;
  end: string;
  cover: 'maui' | 'tahoe' | null;
};
export type ExpenseRecord = Expense & {
  description: string;
  note: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type RepaymentRecord = Repayment & {
  effectiveDate: string;
  note: string;
  creatorId: string;
  createdAt: string;
};
export type Revision = {
  id: string;
  expenseId: string;
  version: number;
  actorId: string;
  at: string;
  reason: string;
  snapshot: ExpenseRecord;
};
export type Activity = {
  id: string;
  sequence: number;
  at: string;
  actorId: string;
  kind: 'created' | 'edited' | 'deleted' | 'repayment';
  recordId: string;
  revisionId?: string;
  snapshot: ExpenseRecord | RepaymentRecord;
};
export type Snapshot = {
  household: Household;
  actorId: string;
  today: string;
  members: Member[];
  expenses: ExpenseRecord[];
  repayments: RepaymentRecord[];
  trips: Trip[];
  revisions: Revision[];
  activity: Activity[];
  generation: number;
};
export type ExpenseInput = Omit<
  ExpenseRecord,
  'id' | 'creatorId' | 'createdAt' | 'updatedAt' | 'version' | 'deleted'
>;
export type RepaymentInput = Omit<
  RepaymentRecord,
  'id' | 'creatorId' | 'createdAt'
>;
export type Command =
  | { kind: 'create-expense'; value: ExpenseInput }
  | {
      kind: 'update-expense';
      id: string;
      expectedVersion: number;
      value: ExpenseInput;
    }
  | {
      kind: 'delete-expense';
      id: string;
      expectedVersion: number;
      reason: string;
    }
  | { kind: 'record-repayment'; value: RepaymentInput }
  | { kind: 'create-trip'; value: Omit<Trip, 'id' | 'cover'> }
  | { kind: 'update-household'; name: string };
export type Entity = ExpenseRecord | RepaymentRecord | Trip | Household;
export type Failure =
  | { status: 'validation'; fields: Record<string, string> }
  | { status: 'conflict'; current: ExpenseRecord }
  | { status: 'deleted'; current: ExpenseRecord }
  | {
      status:
        | 'denied'
        | 'expired'
        | 'unavailable'
        | 'offline'
        | 'unknown'
        | 'operation-conflict';
    };
export type Outcome<T> = { status: 'ok'; value: T } | Failure;
export type Envelope = {
  householdId: string;
  operationId: string;
  command: Command;
};
/** Implement this boundary with a future authorized API, without changing UI consumers. */
export interface DataPort {
  read(householdId: string): Promise<Outcome<Snapshot>>;
  expense(
    householdId: string,
    id: string,
    revision?: number,
  ): Promise<Outcome<ExpenseRecord>>;
  execute(envelope: Envelope): Promise<Outcome<Entity>>;
  operation(
    householdId: string,
    operationId: string,
  ): Promise<Outcome<Entity> | { status: 'not-started' }>;
  subscribe(listener: () => void): () => void;
}
export type Scenario =
  | 'normal'
  | 'slow'
  | 'denied'
  | 'expired'
  | 'offline'
  | 'timeout-after-commit'
  | 'second-editor'
  | 'concurrent-delete';
export type Fixture = 'sample' | 'empty' | 'three-members';
/** Demo controls are separate from the replaceable application port. No security claim. */
export interface DemoControls {
  scenario(value: Scenario): void;
  actor(memberId: string): void;
  reset(fixture?: Fixture): void;
}
