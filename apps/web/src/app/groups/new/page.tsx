import { redirect } from 'next/navigation';
import { GroupJourney } from '@/components/groups/journey';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  if (kind === 'trip') redirect('/trips/new');
  return <GroupJourney creation="ORDINARY" />;
}
