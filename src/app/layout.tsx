import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NavigationProvider } from '@/components/navigation/provider';
import { NavigationShell } from '@/components/navigation/shell';
import './styles.css';
import './navigation.css';
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
            <NavigationShell detail={detail}>{children}</NavigationShell>
          </NavigationProvider>
        </Suspense>
      </body>
    </html>
  );
}
