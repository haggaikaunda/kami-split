import { ActivityWorkspace } from '@/components/activity/feed';
export default async function GroupActivityPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <ActivityWorkspace groupId={groupId} />;
}
