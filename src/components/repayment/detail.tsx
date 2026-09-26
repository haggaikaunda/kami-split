'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatMoney } from '@/lib/ledger';
import { useAppData } from '../data-provider';
import { useExpenseNavigation } from '../navigation/provider';
import { Button, Dialog, Skeleton, Status } from '../primitives';
export function RepaymentDetail({ repaymentId }: { repaymentId: string }) {
  const { snapshot, status, refresh } = useAppData();
  const { returnToSource } = useExpenseNavigation();
  const visit = useSearchParams().get('visit');
  const readable =
    snapshot && ['ready', 'refreshing', 'stale'].includes(status);
  const record = readable
    ? snapshot.repayments.find((row) => row.id === repaymentId)
    : undefined;
  const name = (id: string) =>
    snapshot?.members.find((member) => member.id === id)?.name ??
    'Unavailable member';
  return (
    <Dialog open title="Repayment detail" onClose={() => returnToSource(visit)}>
      {status === 'loading' ? (
        <Skeleton label="Loading repayment" />
      ) : !record ? (
        <Status kind="denied">
          This repayment is unavailable.
          <Button onClick={() => void refresh()}>Try again</Button>
        </Status>
      ) : (
        <>
          {status !== 'ready' && (
            <Status kind="stale">
              Showing the last confirmed repayment while household data is
              refreshed.
            </Status>
          )}
          <h3>
            {name(record.senderId)} repaid {name(record.recipientId)}
          </h3>
          <p className="ui-money">
            {formatMoney(record.amount, record.currency)}
          </p>
          <dl>
            <dt>Repayment date</dt>
            <dd>{record.effectiveDate}</dd>
            <dt>Recorded by</dt>
            <dd>{name(record.creatorId)}</dd>
            <dt>Recorded at</dt>
            <dd>{record.createdAt}</dd>
            <dt>Note</dt>
            <dd>{record.note || 'No note'}</dd>
          </dl>
          <p>
            This records a repayment. No money was moved by Kami Split.
            Repayments do not change expense spending or contributions.
          </p>
          <p>Repayment records are read-only in this demo.</p>
        </>
      )}
      <Button onClick={() => returnToSource(visit)}>
        Back to previous view
      </Button>
      <Link href="/history">History</Link>
    </Dialog>
  );
}
