'use client';
import Link from 'next/link';
import { DeleteExpenseButton } from '../expense-delete';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Dialog, Status } from '../primitives';
import { useExpenseNavigation, useRouteReady } from './provider';
import { useAppData } from '../data-provider';
import { ExpenseRecordView } from '../expense-record';
import type { ExpenseRecord } from '../../lib/data/port';
import type { ReactNode } from 'react';
import './expense.css';
import { fullPageHref, presentation } from './session';

export function ExpenseDestination({
  expenseId,
  intercepted = false,
  renderActions,
}: {
  expenseId: string;
  intercepted?: boolean;
  renderActions?: (record: ExpenseRecord) => ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const visit = params.get('visit');
  const { getSource, returnToSource } = useExpenseNavigation();
  const source = getSource(visit);
  const { snapshot, status, readyVersion, refresh } = useAppData();
  const canShowSnapshot = ['ready', 'refreshing', 'stale'].includes(status);
  const record = canShowSnapshot
    ? snapshot?.expenses.find((row) => row.id === expenseId)
    : undefined;
  useRouteReady(`/expenses/${encodeURIComponent(expenseId)}`, readyVersion);
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
  }, [panel, expenseId, record?.id]);
  const content = (
    <>
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
      {snapshot && record ? (
        <>
          {(status === 'stale' || status === 'refreshing') && (
            <Status kind="info">
              {status === 'stale'
                ? 'Offline. These are previously loaded values; they may be out of date.'
                : 'Refreshing expense… Previously loaded values are shown.'}
            </Status>
          )}
          <ExpenseRecordView
            record={record}
            snapshot={snapshot}
            selectedRevision={params.get('revision')}
            renderActions={
              status === 'ready'
                ? (current) => (
                    <div className="ui-actions">
                      {renderActions?.(current)}
                      <DeleteExpenseButton record={current} />
                    </div>
                  )
                : undefined
            }
          />
        </>
      ) : (
        <>
          <h1 id="expense-heading" data-page-heading tabIndex={-1}>
            {status === 'loading' ? 'Loading expense' : 'Expense unavailable'}
          </h1>
          <Status kind={status === 'loading' ? 'info' : 'denied'}>
            {status === 'loading'
              ? 'Loading the current expense and revision history…'
              : status === 'expired'
                ? 'Your simulated session has expired. No financial details are shown.'
                : 'This expense could not be loaded. No financial details are shown.'}
          </Status>
        </>
      )}
      {(status === 'stale' || status === 'error') && (
        <Button tone="secondary" onClick={() => void refresh()}>
          Retry loading expense
        </Button>
      )}
    </>
  );
  if (panel)
    return (
      <Dialog
        open
        title="Expense details"
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
