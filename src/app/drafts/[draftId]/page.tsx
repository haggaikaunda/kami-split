import { DraftFixture } from '@/components/navigation/fixture';
import { AddExpense } from '@/components/expense-create/form';
export default async function Draft({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return draftId === 'new-expense' ? (
    <AddExpense />
  ) : (
    <DraftFixture draftId={draftId} />
  );
}
