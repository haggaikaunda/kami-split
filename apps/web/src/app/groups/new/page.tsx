import { GroupJourney } from '@/components/groups/journey';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  return <GroupJourney creation={kind === 'trip' ? 'TRIP' : 'ORDINARY'} />;
}
