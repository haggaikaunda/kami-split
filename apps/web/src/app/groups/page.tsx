import { GroupJourney } from '@/components/groups/journey';
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  return <GroupJourney initialGroup={typeof group === 'string' ? group : ''} />;
}
