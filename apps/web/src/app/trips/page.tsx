import { GroupJourney } from '@/components/groups/journey';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  return (
    <GroupJourney
      trips
      filter={filter === 'upcoming' || filter === 'past' ? filter : 'all'}
    />
  );
}
