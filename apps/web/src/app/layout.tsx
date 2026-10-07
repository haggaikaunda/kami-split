import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { FinancialSession } from '@/components/groups/session';
import './styles.css';
const bodyFont = localFont({
  src: './fonts/DMSans.ttf',
  weight: '100 1000',
  variable: '--font-dm-sans',
  display: 'swap',
});
const displayFont = localFont({
  src: './fonts/Manrope.ttf',
  weight: '200 800',
  variable: '--font-manrope',
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
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <Suspense fallback={<p role="status">Loading navigation…</p>}>
          <FinancialSession>{children}</FinancialSession>
        </Suspense>
      </body>
    </html>
  );
}
