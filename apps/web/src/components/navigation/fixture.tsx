'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  Dialog,
  Field,
  Status,
  Confirmation,
} from '../primitives';
import { DraftLink, ExpenseLink } from './links';
import {
  useExpenseNavigation,
  useSessionDraft,
  useRouteContext,
  useRouteReady,
} from './provider';

export function NavigationFixture({
  title,
  route,
}: {
  title: string;
  route: string;
}) {
  const {
    searchParams: params,
    refreshVersion: readyVersion,
    isActive,
  } = useRouteContext(route);
  useRouteReady(route, readyVersion);
  const {
    removedFixtureIds,
    openContext,
    returnToSource,
    getSource,
    refreshVersion,
  } = useExpenseNavigation();
  const bucket = params.get('bucket');
  const visit = params.get('visit');
  const current = new URLSearchParams(params);
  function query(values: Record<string, string>) {
    const next = new URLSearchParams(current);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    return `${route}?${next}`;
  }
  const row = removedFixtureIds.includes('102') ? (
    <p>No matching example records. Your filters remain selected.</p>
  ) : (
    <p>
      <ExpenseLink
        id={`${bucket ? 'bucket' : 'list'}-expense-102`}
        expenseId="102"
      >
        Open expense 102
      </ExpenseLink>
    </p>
  );
  return (
    <>
      <h1 data-page-heading tabIndex={-1}>
        {title}
      </h1>
      <p className="fixture-label">
        Navigation fixture · financial journey content will be added in a later
        issue
      </p>
      <Card title="Preserved working context">
        <p>
          Selected view: {params.get('tab') ?? 'overview'} · Search:{' '}
          {params.get('search') ?? 'all'} · Chart:{' '}
          {params.get('mode') ?? 'monthly'},{' '}
          {params.get('scope') ?? 'household'},{' '}
          {params.get('period') ?? '2026-09'}
        </p>
        <div className="fixture-links">
          <Link href={query({ search: 'Poke', tab: 'expenses' })}>
            Example search: Poke
          </Link>
          <Link href={query({ tab: 'expenses' })}>Expenses tab</Link>
          <Link
            href={query({ mode: 'daily', scope: 'mine', period: '2026-09' })}
          >
            September daily personal chart
          </Link>
          {route === '/trips' && (
            <Link href="/trips/maui?tab=expenses&search=Poke">
              Open Maui example
            </Link>
          )}
          <Link
            id="chart-bucket-20"
            href={query({ bucket: '2026-09-20' })}
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                event.button === 0
              ) {
                event.preventDefault();
                openContext(query({ bucket: '2026-09-20' }), 'chart-bucket-20');
              }
            }}
          >
            Inspect September 20 bucket
          </Link>
          <DraftLink id="add-example" draftId="new-expense">
            Add expense example
          </DraftLink>
        </div>
        <div className="fixture-scroll-space">
          <p>Scroll to exercise source-position restoration.</p>
        </div>
        {!bucket && row}
        <p className="fixture-label">Fresh-query signal: {refreshVersion}</p>
      </Card>
      {bucket && !isActive && (
        <section aria-label={`Retained expense bucket ${bucket}`}>
          {row}
        </section>
      )}
      {bucket && isActive && (
        <Dialog
          open
          title={`Expense bucket ${bucket}`}
          onClose={() => returnToSource(visit)}
        >
          <p>
            Chart context stays in the URL; these are example navigation
            records.
          </p>
          {row}
          {getSource(visit) ? (
            <Button onClick={() => returnToSource(visit)}>Close bucket</Button>
          ) : (
            <Link href={route}>Return to {title.toLowerCase()}</Link>
          )}
        </Dialog>
      )}
    </>
  );
}

export function DraftFixture({ draftId }: { draftId: string }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { draft, update, setPending, discard } =
    useSessionDraft<Record<string, string>>(draftId);
  const { getSource, returnToSource } = useExpenseNavigation();
  const params = useSearchParams();
  const visit = params.get('visit');
  return (
    <>
      <h1 data-page-heading tabIndex={-1}>
        Expense draft example
      </h1>
      <p className="fixture-label">
        Navigation fixture · no financial record is saved
      </p>
      <Status>
        Typing preserves a session draft. Navigation, Back and resizing keep its
        fields and operation identity. Reloading or closing the page asks before
        losing the session.
      </Status>
      <Field
        id="draft-description"
        label="Description"
        value={draft?.values.description ?? ''}
        disabled={draft?.pending}
        onChange={(event) =>
          update(
            { ...draft?.values, description: event.target.value },
            'expense example',
          )
        }
      />
      <Field
        id="draft-note"
        label="Private note (never in URL)"
        value={draft?.values.note ?? ''}
        disabled={draft?.pending}
        onChange={(event) =>
          update(
            { ...draft?.values, note: event.target.value },
            'expense example',
          )
        }
      />
      <p>
        Draft state:{' '}
        {draft ? (draft.pending ? 'Request pending' : 'Preserved') : 'Empty'}
      </p>
      <div className="ui-actions">
        <Button
          tone="secondary"
          disabled={!draft}
          onClick={() => setPending(!draft?.pending)}
        >
          {draft?.pending
            ? 'End simulated request'
            : 'Simulate pending request'}
        </Button>
        {getSource(visit) ? (
          <Button tone="secondary" onClick={() => returnToSource(visit)}>
            Leave and preserve draft
          </Button>
        ) : (
          <Link href="/history">Back to history</Link>
        )}
        <Button
          tone="secondary"
          disabled={!draft || draft.pending}
          onClick={() => setConfirmDiscard(true)}
        >
          Clear this example draft
        </Button>
      </div>
      <Confirmation
        open={confirmDiscard}
        title="Clear this example draft?"
        confirmLabel="Discard draft"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          discard();
          setConfirmDiscard(false);
        }}
      >
        Your unsaved fields will be removed from this session.
      </Confirmation>
    </>
  );
}
