import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Kami Split',
  description: 'Shared expenses, simply settled.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
