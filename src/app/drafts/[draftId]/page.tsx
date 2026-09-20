import { DraftFixture } from '@/components/navigation/fixture';
export default async function Draft({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <DraftFixture draftId={draftId} />;
}
