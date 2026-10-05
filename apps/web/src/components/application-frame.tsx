'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HouseholdCommandsProvider } from '@/components/household-controller';
import { ExpenseDeletionProvider } from '@/components/expense-delete';
import { AppDataProvider } from '@/components/data-provider';
import { NavigationProvider } from '@/components/navigation/provider';
import { NavigationShell } from '@/components/navigation/shell';
import { ExpenseCreationProvider } from '@/components/expense-create/controller';
export function ApplicationFrame({
  children,
  detail,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  const path = usePathname();
  if (
    path === '/household/activity' ||
    path === '/household/expenses' ||
    path === '/groups' ||
    path.startsWith('/groups/') ||
    path === '/trips' ||
    path === '/sign-in' ||
    path === '/join' ||
    path === '/account' ||
    path.startsWith('/auth/') ||
    path === '/invitations'
  )
    return <>{children}</>;
  return (
    <NavigationProvider>
      <AppDataProvider>
        <ExpenseCreationProvider>
          <ExpenseDeletionProvider>
            <HouseholdCommandsProvider>
              <div
                role="note"
                style={{ padding: '0.5rem', textAlign: 'center' }}
              >
                Demo preview · simulated data.{' '}
                <Link href="/groups">Open your real groups</Link>
              </div>
              <NavigationShell detail={detail}>{children}</NavigationShell>
            </HouseholdCommandsProvider>
          </ExpenseDeletionProvider>
        </ExpenseCreationProvider>
      </AppDataProvider>
    </NavigationProvider>
  );
}
