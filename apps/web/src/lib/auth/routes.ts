import { financialReturn } from '@/lib/relay/discovery';

/** Legacy email/invitation entry paths hand off to the only public page. */
export function entryFlow(pathname: string) {
  return pathname === '/join'
    ? 'join'
    : pathname === '/auth/confirm'
      ? 'confirm'
      : pathname === '/auth/password'
        ? 'password'
        : undefined;
}

/** Deliberately allow individual resources, never arbitrary extension-shaped routes. */
export function publicResource(pathname: string) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/static/') ||
    pathname === '/_next/image' ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname === '/art/household.png' ||
    pathname === '/art/trip.png'
  );
}

/** Queries carrying credentials or unsupported fields are discarded by financialReturn. */
export function signInHref(destination: string) {
  return '/sign-in?next=' + encodeURIComponent(financialReturn(destination));
}
