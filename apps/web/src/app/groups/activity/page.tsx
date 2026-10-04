import { redirect } from 'next/navigation';
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  redirect(
    typeof group === 'string' && group
      ? `/groups/${encodeURIComponent(group)}/activity`
      : '/household/activity',
  );
}
