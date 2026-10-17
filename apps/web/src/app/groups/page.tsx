import { redirect } from 'next/navigation';
import { GroupJourney } from '@/components/groups/journey';
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; kind?: string; filter?: string }>;
}) {
  const { group, kind, filter } = await searchParams;
  if (typeof group === 'string' && group)
    redirect(`/groups/${encodeURIComponent(group)}`);
  return (
    <GroupJourney
      selection={kind === 'groups' || kind === 'trips' ? kind : 'all'}
      filter={filter === 'upcoming' || filter === 'past' ? filter : 'all'}
    />
  );
}
