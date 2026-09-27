'use client';
import { useCallback } from 'react';
import type { ExpenseInput } from '../../lib/data/port';
import {
  SessionCommandProvider,
  useSessionCommand,
  type CommandState,
} from '../session-command';
export type CreationState = CommandState;
export const ExpenseCreationProvider = SessionCommandProvider;
export function useExpenseCreation() {
  const { states, submit: command, recover } = useSessionCommand();
  const submit = useCallback(
    (
      draftId: string,
      operationId: string,
      value: ExpenseInput,
      visit: string | null,
    ) =>
      command(draftId, operationId, { kind: 'create-expense', value }, visit),
    [command],
  );
  return { states, submit, recover };
}
