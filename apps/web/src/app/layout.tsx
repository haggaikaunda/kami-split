import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { HouseholdCommandsProvider } from '@/components/household-controller';
import { ExpenseDeletionProvider } from '@/components/expense-delete';
import { AppDataProvider } from '@/components/data-provider';
import './overview.css';
import { NavigationProvider } from '@/components/navigation/provider';
import { NavigationShell } from '@/components/navigation/shell';
import { ExpenseCreationProvider } from '@/components/expense-create/controller';
import './styles.css';
import './navigation.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Kami Split',
  description: 'Shared expenses, simply settled.',
};
export default function RootLayout({
  children,
  detail,
}: Readonly<{ children: React.ReactNode; detail: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<p role="status">Loading navigation…</p>}>
          <NavigationProvider>
            <AppDataProvider>
              <ExpenseCreationProvider>
                <ExpenseDeletionProvider>
                  <HouseholdCommandsProvider>
                    <NavigationShell detail={detail}>
                      {children}
                    </NavigationShell>
                  </HouseholdCommandsProvider>
                </ExpenseDeletionProvider>
              </ExpenseCreationProvider>
            </AppDataProvider>
          </NavigationProvider>
        </Suspense>
      </body>
    </html>
  );
}
