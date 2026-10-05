'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const paths = {
  leaf: 'M20 3C10 2 3 6 4 14c1 7 13 8 16-11ZM3 21 16 8',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  groups:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  trip: 'm3 20 6-15 4 8 3-5 5 12H3ZM7 10l2 2 2-2',
  account: 'M20 21v-2a7 7 0 0 0-14 0v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  expense: 'M5 5h14v16l-3-2-4 2-4-2-3 2V5ZM8 9h8M8 13h5',
  groceries: 'M2 3h3l3 13h11l3-9H6M10 21h.01M18 21h.01',
  dining: 'M4 3v7a3 3 0 0 0 6 0V3M7 3v18M19 21V3c-4 2-4 10 0 10',
  bed: 'M3 18V7M21 18V7M3 14h18M3 10h18M7 7h3v3H7ZM14 7h3v3h-3Z',
  car: 'm4 10 2-6h12l2 6M3 10h18v8H3V10ZM5 18v3M19 18v3M6 14h2M16 14h2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  other: 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z',
} as const;
export type IconName = keyof typeof paths;
export function AppIcon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`app-icon ${className}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="workspace-brand">
      <AppIcon name="leaf" />
      <span>Kami Split</span>
    </span>
  );
}
/** Static navigation never reads or retains private group data. */
export function WorkspaceNavigation() {
  const pathname = usePathname();
  const items = [
    { href: '/household', label: 'Household', icon: 'home' },
    { href: '/groups', label: 'Groups', icon: 'groups' },
    { href: '/trips', label: 'Trips', icon: 'trip' },
    { href: '/account', label: 'Account', icon: 'account' },
  ] as const;
  return (
    <nav className="workspace-navigation" aria-label="Financial navigation">
      <span className="workspace-navigation-brand">
        <Brand />
      </span>
      <div className="workspace-navigation-links">
        {items.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href || pathname.startsWith(href + '/')
                ? 'page'
                : undefined
            }
          >
            <AppIcon name={icon} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
const categories: Record<string, IconName> = {
  DINING: 'dining',
  GROCERIES: 'groceries',
  ACCOMMODATION: 'bed',
  TRANSPORT: 'car',
  ACTIVITIES: 'activity',
  HOME: 'home',
  OTHER: 'other',
};
export function CategoryIcon({ category }: { category: string }) {
  return (
    <span
      className={`category-icon category-icon--${category.toLowerCase()}`}
      aria-label={category.toLowerCase()}
    >
      <AppIcon name={categories[category] ?? 'other'} />
    </span>
  );
}
