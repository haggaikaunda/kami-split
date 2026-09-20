'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Dialog, Status } from '../primitives';
import { useExpenseNavigation, useRouteReady } from './provider';
import { DraftLink } from './links';
import { fullPageHref, presentation } from './session';

export function ExpenseDestination({
  expenseId,
  intercepted = false,
}: {
  expenseId: string;
  intercepted?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const visit = params.get('visit');
  const {
    getSource,
    returnToSource,
    removeFixtureRecord,
    removedFixtureIds,
    refreshVersion,
  } = useExpenseNavigation();
  const source = getSource(visit);
  useRouteReady(`/expenses/${encodeURIComponent(expenseId)}`, refreshVersion);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const panel =
    presentation(
      intercepted && !!source,
      width,
      params.get('view') === 'full',
    ) === 'panel';
  useEffect(() => {
    if (!panel)
      document
        .getElementById('expense-heading')
        ?.focus({ preventScroll: true });
  }, [panel, expenseId]);
  const content = (
    <>
      <p className="fixture-label">
        Navigation fixture · financial detail is not implemented yet
      </p>
      <h1 id="expense-heading" data-page-heading tabIndex={-1}>
        Expense {expenseId}
      </h1>
      {expenseId !== '102' ? (
        <Status kind="denied">
          This example record is unavailable. No financial details are shown.
        </Status>
      ) : removedFixtureIds.includes(expenseId) ? (
        <Status kind="info">
          This fixture row was removed from source results. Financial data was
          not changed.
        </Status>
      ) : (
        <>
          <p>
            The same expense identity appears in panel and page presentations.
          </p>
          <Link href="/trips/maui?tab=expenses">
            Open associated trip example
          </Link>
          <p>
            <DraftLink id="edit-example" draftId={`expense-${expenseId}`}>
              Edit draft example
            </DraftLink>
          </p>
          <div className="ui-actions">
            <Button
              tone="secondary"
              onClick={() => removeFixtureRecord(expenseId)}
            >
              Simulate row removed from source
            </Button>
          </div>
        </>
      )}
      <div className="ui-actions">
        {source ? (
          <Button tone="secondary" onClick={() => returnToSource(visit)}>
            Back to previous view
          </Button>
        ) : (
          <Link className="shell-action" href="/history">
            Back to history
          </Link>
        )}
        {panel && (
          <Button
            tone="secondary"
            onClick={() =>
              router.replace(
                fullPageHref(window.location.pathname + window.location.search),
                { scroll: false },
              )
            }
          >
            Open full page
          </Button>
        )}
      </div>
    </>
  );
  if (panel)
    return (
      <Dialog
        open
        title={`Expense ${expenseId}`}
        panel
        onClose={() => returnToSource(visit)}
      >
        {content}
      </Dialog>
    );
  return intercepted ? (
    <main className="expense-page">{content}</main>
  ) : (
    <section className="expense-page">{content}</section>
  );
}
