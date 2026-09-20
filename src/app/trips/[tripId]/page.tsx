import { NavigationFixture } from '@/components/navigation/fixture';
export default async function Trip({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <NavigationFixture
      title={`Trip ${tripId}`}
      route={`/trips/${encodeURIComponent(tripId)}`}
    />
  );
}
