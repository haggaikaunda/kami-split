/* eslint-disable @typescript-eslint/no-require-imports -- Shared opt-in synthetic browser fixture. */
const http = require('node:http');
const authOrigin = process.env.BROWSER_AUTH_ORIGIN || 'http://localhost:3196';
/** Seed the supported SSR cookie instead of the retired localStorage-only session. */
async function seedSession(context, origin, session) {
  await context.addCookies([
    {
      name: 'kami-auth',
      value:
        'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
      url: origin,
      sameSite: 'Lax',
      secure: new URL(origin).protocol === 'https:',
    },
  ]);
}
/** Next must be started with ONBOARDING_PUBLIC_SUPABASE_URL matching authOrigin. */
async function startAuthFixture(origin, session) {
  const url = new URL(authOrigin);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Synthetic Auth fixture requires a loopback HTTP origin');
  const server = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    );
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, OPTIONS',
    );
    if (request.method === 'OPTIONS' || request.url.includes('/logout')) {
      response.writeHead(204);
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(request.url.includes('/user') ? session.user : session),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(
      Number(url.port || 80),
      url.hostname.replace(/^\[|\]$/g, ''),
      resolve,
    );
  });
  server.unref();
  return {
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
async function withAuthFixture(origin, session, work) {
  const fixture = await startAuthFixture(origin, session);
  try {
    return await work();
  } finally {
    await fixture.close();
  }
}
module.exports = { authOrigin, seedSession, startAuthFixture, withAuthFixture };
