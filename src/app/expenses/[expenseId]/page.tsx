import { ExpenseDestination } from '@/components/navigation/expense';
export default async function Expense({
  params,
}: {
  params: Promise<{ expenseId: string }>;
}) {
  const { expenseId } = await params;
  return <ExpenseDestination expenseId={expenseId} />;
}
