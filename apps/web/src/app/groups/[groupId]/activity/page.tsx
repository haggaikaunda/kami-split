import { routeId } from '@/lib/relay/discovery';
import { redirect } from 'next/navigation';
export default async function GroupActivityPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  redirect(`/groups/${encodeURIComponent(routeId(groupId))}?tab=activity`);
}
