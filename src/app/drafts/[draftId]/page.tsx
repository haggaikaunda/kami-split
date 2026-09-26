import { DraftFixture } from '@/components/navigation/fixture';
import { EditExpense } from '@/components/expense-edit/form';
import { AddExpense } from '@/components/expense-create/form';
export default async function Draft({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return draftId === 'new-expense' ? (
    <AddExpense />
  ) : draftId.startsWith('edit-expense-') ? (
    <EditExpense expenseId={draftId.slice('edit-expense-'.length)} />
  ) : (
    <DraftFixture draftId={draftId} />
  );
}
