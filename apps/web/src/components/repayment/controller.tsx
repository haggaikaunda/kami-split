'use client';
import { useCallback } from 'react';
import type { RepaymentInput } from '@/lib/data/port';
import { useSessionCommand } from '../session-command';
export function useRepaymentCreation() {
  const { states, submit: command, recover } = useSessionCommand();
  const submit = useCallback(
    (
      draftId: string,
      operationId: string,
      value: RepaymentInput,
      visit: string | null,
    ) =>
      command(draftId, operationId, { kind: 'record-repayment', value }, visit),
    [command],
  );
  return { states, submit, recover };
}
