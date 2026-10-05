import { redirect } from 'next/navigation';
import { GroupJourney } from '@/components/groups/journey';
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  if (typeof group === 'string' && group)
    redirect(`/groups/${encodeURIComponent(group)}`);
  return <GroupJourney />;
}
