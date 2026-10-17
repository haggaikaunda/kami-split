import { redirect } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'string') params.set(key, value);
  }
  params.set('kind', 'trips');
  if (!['upcoming', 'past'].includes(params.get('filter') ?? ''))
    params.delete('filter');
  redirect(`/groups?${params}`);
}
