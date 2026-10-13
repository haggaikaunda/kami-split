import { OnboardingEntry } from '@/components/onboarding/entry';
import { financialReturn } from '@/lib/relay/discovery';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const mode =
    query.flow === 'join'
      ? 'join'
      : query.flow === 'confirm'
        ? 'confirm'
        : query.flow === 'password'
          ? 'password'
          : 'sign-in';
  return (
    <>
      {query.auth === 'unavailable' && (
        <div role="alert">
          Account verification is unavailable. Sign in or{' '}
          <a
            href={financialReturn(
              typeof query.next === 'string' ? query.next : null,
            )}
          >
            retry account access
          </a>
          .
        </div>
      )}
      <OnboardingEntry mode={mode} />
    </>
  );
}
