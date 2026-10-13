/** No server routing runs in the standalone presentation gallery. */
export function usePathname() {
  return window.location.pathname;
}
