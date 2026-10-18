import { appearanceBootstrap } from '@/lib/appearance';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { AuthBoundary } from '@/components/groups/auth-boundary';
import { FinancialSession } from '@/components/groups/session';
import { FocusInput } from '@/components/ui/focus-input';
import { ScreenLoading } from '@/components/ui/loading';
// Anchor the shared cascade before route styles; Next also deduplicates the
// same colocated imports in components. Preserve this order when moving owners.
import '../components/ui/primitives.module.css';
import '../components/ui/loading.module.css';
import '../components/ui/form-layout.module.css';
import '../components/workspace/shell.module.css';
import '../components/workspace/patterns.module.css';
import '../components/financial/presentation.module.css';
import './tokens.css';
import './base.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
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
        <meta name="theme-color" content="" />
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
      </head>
      <body>
        <FocusInput />
        <Suspense fallback={<ScreenLoading />}>
          <FinancialSession>
            <AuthBoundary>{children}</AuthBoundary>
          </FinancialSession>
        </Suspense>
      </body>
    </html>
  );
}
