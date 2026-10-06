import { HouseholdFrame } from '@/components/groups/household-frame';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <HouseholdFrame>{children}</HouseholdFrame>;
}
