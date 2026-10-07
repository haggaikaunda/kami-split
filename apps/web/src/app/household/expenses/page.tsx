import { Suspense } from 'react';
import { HouseholdExpenses } from '@/components/expenses/household';
export default function Page() {
  return (
    <Suspense fallback={<p>Loading expenses…</p>}>
      <HouseholdExpenses />
    </Suspense>
  );
}
