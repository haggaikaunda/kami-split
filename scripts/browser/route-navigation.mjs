// A metadata prefetch can share a destination's tab without blocking activation.
// Hold the exact activated route, ignoring only Next's Flight cache key.
export function isRouteNavigation(request, destination) {
  const headers = request.headers();
  if (headers.rsc !== '1' || headers['next-router-prefetch']) return false;
  const actual = new URL(request.url());
  actual.searchParams.delete('_rsc');
  actual.searchParams.sort();
  const expected = new URL(destination, actual.origin);
  expected.searchParams.sort();
  return actual.href === expected.href;
}
