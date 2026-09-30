import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { ApplicationFrame } from '@/components/application-frame';
import './overview.css';
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
          <ApplicationFrame detail={detail}>{children}</ApplicationFrame>
        </Suspense>
      </body>
    </html>
  );
}
