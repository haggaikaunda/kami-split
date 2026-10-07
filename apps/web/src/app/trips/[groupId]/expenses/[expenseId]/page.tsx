import { GroupJourney } from '@/components/groups/journey';
export default async function Page({
  params,
}: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const { groupId, expenseId } = await params;
  return <GroupJourney trips initialGroup={groupId} expense={expenseId} />;
}
