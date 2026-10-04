import { ActivityWorkspace } from '@/components/activity/feed';
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  return <ActivityWorkspace groupId={typeof group === 'string' ? group : ''} />;
}
