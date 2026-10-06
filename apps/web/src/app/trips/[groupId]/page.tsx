import { GroupJourney } from '@/components/groups/journey';
export default async function Page({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <GroupJourney trips initialGroup={groupId} />;
}
