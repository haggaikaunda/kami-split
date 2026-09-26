import { CreateTrip } from '@/components/trips/form';
import { DraftFixture } from '@/components/navigation/fixture';
import { RecordRepayment } from '@/components/repayment/form';
import { AddExpense } from '@/components/expense-create/form';
export default async function Draft({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  if (draftId === 'new-trip') return <CreateTrip />;
  if (draftId === 'new-repayment') return <RecordRepayment />;
  return draftId === 'new-expense' ? (
    <AddExpense />
  ) : (
    <DraftFixture draftId={draftId} />
  );
}
