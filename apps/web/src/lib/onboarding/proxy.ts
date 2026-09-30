/** Same-origin, fixed-destination proxy. Never forwards provider/admin secrets. */
export async function proxy(request: Request, path: string) {
  const origin = process.env.ONBOARDING_ORIGIN;
  const endpoint = process.env.ONBOARDING_API_URL;
  if (!origin || !endpoint)
    return Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
  if (
    request.headers.get('origin') !== origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return Response.json({ code: 'INVALID_ORIGIN' }, { status: 403 });
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    return Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        break;
      }
      chunks.push(chunk.value);
    }
  }
  if (size > 65536)
    return Response.json({ code: 'INVALID_INPUT' }, { status: 413 });
  const body = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: origin,
    };
    for (const name of ['authorization', 'cookie']) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    const response = await fetch(`${endpoint.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
    });
    const out = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) out.set('set-cookie', cookie);
    return new Response(await response.text(), {
      status: response.status,
      headers: out,
    });
  } catch {
    return Response.json(
      { code: 'UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
