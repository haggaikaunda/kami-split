'use client';
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { useExpenseNavigation } from './provider';
import { expenseHref } from './session';
function ordinaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
export function ExpenseLink({
  expenseId,
  id,
  children,
}: {
  expenseId: string;
  id: string;
  children: ReactNode;
}) {
  const { openExpense } = useExpenseNavigation();
  return (
    <Link
      id={id}
      href={expenseHref(expenseId)}
      onClick={(event) => {
        if (ordinaryClick(event)) {
          event.preventDefault();
          openExpense(expenseId, id);
        }
      }}
    >
      {children}
    </Link>
  );
}
export function DraftLink({
  draftId,
  id,
  children,
}: {
  draftId: string;
  id: string;
  children: ReactNode;
}) {
  const { openDraft } = useExpenseNavigation();
  return (
    <Link
      id={id}
      href={`/drafts/${encodeURIComponent(draftId)}`}
      onClick={(event) => {
        if (ordinaryClick(event)) {
          event.preventDefault();
          openDraft(draftId, id);
        }
      }}
    >
      {children}
    </Link>
  );
}
