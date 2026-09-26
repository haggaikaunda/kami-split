import { TripDestination } from '@/components/trips/destination';
export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  return <TripDestination tripId={(await params).tripId} />;
}
