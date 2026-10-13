import { appearanceBootstrap } from '@/lib/appearance';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { FinancialSession } from '@/components/groups/session';
import './styles.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Kami Grow',
  description: 'Shared expenses, simply settled.',
  appleWebApp: {
    capable: true,
    title: 'Kami Grow',
    statusBarStyle: 'default',
  },
  // Next.js emits mobile-web-app-capable; retain Apple's legacy capability too.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
      </head>
      <body>
        <Suspense fallback={<p role="status">Loading navigation…</p>}>
          <FinancialSession>{children}</FinancialSession>
        </Suspense>
      </body>
    </html>
  );
}
