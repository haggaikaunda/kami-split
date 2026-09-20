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
  revision,
  id,
  children,
}: {
  expenseId: string;
  revision?: number;
  id: string;
  children: ReactNode;
}) {
  const { openExpense, openContext } = useExpenseNavigation();
  const href =
    expenseHref(expenseId) +
    (revision === undefined ? '' : `?revision=${revision}`);
  return (
    <Link
      id={id}
      href={href}
      onClick={(event) => {
        if (ordinaryClick(event)) {
          event.preventDefault();
          if (revision === undefined) openExpense(expenseId, id);
          else openContext(href, id);
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
