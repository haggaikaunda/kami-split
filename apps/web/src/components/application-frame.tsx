'use client';
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
              <NavigationShell detail={detail}>{children}</NavigationShell>
            </HouseholdCommandsProvider>
          </ExpenseDeletionProvider>
        </ExpenseCreationProvider>
      </AppDataProvider>
    </NavigationProvider>
  );
}
