import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
const sdk = vi.hoisted(() => ({ getUser: vi.fn(), refresh: false }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        getAll(): unknown[];
        setAll(
          value: { name: string; value: string; options: { path: string } }[],
        ): void;
      };
    },
  ) => {
    options.cookies.getAll();
    if (sdk.refresh)
      options.cookies.setAll([
        { name: 'kami-auth', value: 'refreshed', options: { path: '/' } },
      ]);
    return { auth: { getUser: sdk.getUser } };
  },
}));
beforeEach(() => {
  vi.stubEnv('ONBOARDING_PUBLIC_SUPABASE_URL', 'https://auth.example.test');
  vi.stubEnv('ONBOARDING_PUBLIC_SUPABASE_KEY', 'public');
  sdk.refresh = false;
  sdk.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: null }, error: null });
});
it.each([
  '/',
  '/household',
  '/household/expenses',
  '/groups',
  '/groups/G',
  '/groups/G/expenses/new',
  '/trips',
  '/trips/T',
  '/account',
  '/invitations',
  '/future/page',
  '/future/page.png',
  '/icons/private.png',
  '/manifest.json/private',
  '/apple-icon.png/private',
  '/sign-in/nested',
])(
  'denies signed-out HTML and Flight page %s before rendering',
  async (path) => {
    for (const headers of [
      new Headers(),
      new Headers({ RSC: '1', 'Next-Router-Prefetch': '1' }),
    ]) {
      const response = await proxy(
        new NextRequest('https://app.test' + path, { headers }),
      );
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).pathname).toBe(
        '/sign-in',
      );
      expect(response.headers.get('x-middleware-next')).toBeNull();
      expect(await response.text()).not.toContain('Household');
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  },
);
it('never trusts cookie identity and passes only a freshly verified request', async () => {
  sdk.getUser.mockResolvedValue({
    data: { user: { id: 'verified' } },
    error: null,
  });
  sdk.refresh = true;
  const response = await proxy(
    new NextRequest('https://app.test/groups/G', {
      headers: { cookie: 'kami-auth=forged' },
    }),
  );
  expect(sdk.getUser).toHaveBeenCalledOnce();
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(response.cookies.get('kami-auth')?.value).toBe('refreshed');
});
it.each([
  { data: { user: null }, error: { name: 'AuthApiError', status: 401 } },
  {
    data: { user: { id: 'untrusted' } },
    error: { name: 'AuthApiError', status: 403 },
  },
  {
    data: { user: null },
    error: { name: 'AuthRetryableFetchError', status: 503 },
  },
])(
  'fails closed on expired/revoked/rejected or unavailable verification',
  async (result) => {
    sdk.refresh = true;
    sdk.getUser.mockResolvedValue(result);
    const response = await proxy(new NextRequest('https://app.test/account'));
    expect(response.status).toBe(307);
    expect(response.cookies.get('kami-auth')?.value).toBe('refreshed');
    if (result.error.status === 503)
      expect(response.headers.get('location')).toContain('auth=unavailable');
  },
);
it('makes thrown transport and configuration failures actionable without exposing errors', async () => {
  sdk.getUser.mockRejectedValue(new Error('private provider error'));
  const response = await proxy(new NextRequest('https://app.test/household'));
  expect(response.headers.get('location')).toContain('auth=unavailable');
  expect(await response.text()).not.toContain('private provider error');
  vi.stubEnv('ONBOARDING_PUBLIC_SUPABASE_KEY', '');
  expect(
    (await proxy(new NextRequest('https://app.test/household'))).status,
  ).toBe(307);
});
it('retains safe destinations but discards secrets, loops and framework query metadata', async () => {
  const response = await proxy(
    new NextRequest('https://app.test/groups/G?tab=balances&_rsc=xyz'),
  );
  expect(
    new URL(response.headers.get('location')!).searchParams.get('next'),
  ).toBe('/groups/G?tab=balances');
  const unsafe = await proxy(
    new NextRequest('https://app.test/groups/G?token=secret'),
  );
  expect(
    new URL(unsafe.headers.get('location')!).searchParams.get('next'),
  ).toBe('/groups');
});
it.each([
  ['/join', 'join'],
  ['/auth/confirm', 'confirm'],
  ['/auth/password', 'password'],
])(
  'hands off %s without forwarding invitation or verification queries',
  async (path, flow) => {
    const response = await proxy(
      new NextRequest(
        'https://app.test' + path + '?token_hash=private&next=//evil.test',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://app.test/sign-in?flow=' + flow,
    );
    expect(sdk.getUser).not.toHaveBeenCalled();
  },
);
it.each([
  '/sign-in',
  '/api/onboarding/start',
  '/api/graphql',
  '/_next/static/chunk.js',
  '/_next/image',
  '/art/household.png',
  '/manifest.json',
  '/apple-icon.png',
  '/icons/kami-grow-192.png',
  '/icons/kami-grow-512.png',
])('leaves %s accessible to its existing handler', async (path) => {
  expect(
    (await proxy(new NextRequest('https://app.test' + path))).headers.get(
      'x-middleware-next',
    ),
  ).toBe('1');
  expect(sdk.getUser).not.toHaveBeenCalled();
});
