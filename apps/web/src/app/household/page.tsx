import { redirect } from 'next/navigation';
import { HouseholdWorkspace } from '@/components/groups/household-workspace';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.tab === 'expenses') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'tab' && typeof value === 'string') query.set(key, value);
    }
    redirect(`/household/expenses${query.size ? `?${query}` : ''}`);
  }
  return <HouseholdWorkspace />;
}
