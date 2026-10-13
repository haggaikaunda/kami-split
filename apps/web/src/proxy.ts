import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { entryFlow, publicResource, signInHref } from '@/lib/auth/routes';

/** Default-deny page boundary: verification precedes both HTML and Flight rendering. */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (publicResource(pathname)) return NextResponse.next();
  const finish = (response: NextResponse) => {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  const flow = entryFlow(pathname);
  if (flow) {
    // HTTP redirects inherit the original fragment in the browser. Never copy it
    // (or callback/capability queries) into a server-visible Location query.
    return finish(
      NextResponse.redirect(new URL('/sign-in?flow=' + flow, request.url)),
    );
  }
  if (pathname === '/sign-in') return finish(NextResponse.next());
  const requested = request.nextUrl.clone();
  requested.searchParams.delete('_rsc');
  const destination = pathname + requested.search;
  const denied = (unavailable = false) => {
    const target = new URL(signInHref(destination), request.url);
    if (unavailable) target.searchParams.set('auth', 'unavailable');
    return NextResponse.redirect(target);
  };
  let response = NextResponse.next({ request });
  try {
    const url = process.env.ONBOARDING_PUBLIC_SUPABASE_URL;
    const key = process.env.ONBOARDING_PUBLIC_SUPABASE_KEY;
    if (!url || !key) return finish(denied(true));
    const client = createServerClient(url, key, {
      cookieOptions: {
        name: 'kami-auth',
        path: '/',
        sameSite: 'lax',
        secure: request.nextUrl.protocol === 'https:',
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: 'no-store',
            signal: AbortSignal.any([
              ...(init?.signal ? [init.signal] : []),
              AbortSignal.timeout(12000),
            ]),
          }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value } of cookies)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookies)
            response.cookies.set(name, value, options);
        },
      },
    });
    // getSession merely reads the cookie. getUser verifies with the Auth service
    // on every request, including refresh and provider rejection of a session.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      if (
        error &&
        (!error.status || error.status >= 500) &&
        error.name !== 'AuthSessionMissingError'
      )
        console.warn('auth.boundary', { outcome: 'verification_unavailable' });
      const redirect = denied(
        !!error && (!error.status || error.status >= 500),
      );
      for (const cookie of response.cookies.getAll())
        redirect.cookies.set(cookie);
      return finish(redirect);
    }
    return finish(response);
  } catch {
    // This request boundary owns unexpected diagnostics; never log provider
    // errors, cookie values, destinations or account identifiers.
    console.warn('auth.boundary', { outcome: 'verification_unavailable' });
    const redirect = denied(true);
    for (const cookie of response.cookies.getAll())
      redirect.cookies.set(cookie);
    return finish(redirect);
  }
}
