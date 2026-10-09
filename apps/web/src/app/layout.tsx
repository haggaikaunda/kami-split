import { appearanceBootstrap } from '@/lib/appearance';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { FinancialSession } from '@/components/groups/session';
import './styles.css';
const bodyFont = localFont({
  src: './fonts/Roboto.ttf',
  weight: '100 900',
  variable: '--font-roboto',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Kami Grow',
  description: 'Shared expenses, simply settled.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={bodyFont.variable}>
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
