import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { FinancialSession } from '@/components/groups/session';
import { ApplicationFrame } from '@/components/application-frame';
import './overview.css';
import './styles.css';
import './navigation.css';
const bodyFont = localFont({
  src: './fonts/DMSans.ttf',
  variable: '--font-dm-sans',
  display: 'swap',
});
const displayFont = localFont({
  src: './fonts/Manrope.ttf',
  variable: '--font-manrope',
  display: 'swap',
});

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
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <Suspense fallback={<p role="status">Loading navigation…</p>}>
          <FinancialSession>
            <ApplicationFrame detail={detail}>{children}</ApplicationFrame>
          </FinancialSession>
        </Suspense>
      </body>
    </html>
  );
}
