import { ContentLoading } from '@/components/ui/loading';
import { Suspense } from 'react';
import { HouseholdExpenses } from '@/components/expenses/household';
export default function Page() {
  return (
    <Suspense fallback={<ContentLoading layout="expenses" />}>
      <HouseholdExpenses />
    </Suspense>
  );
}
