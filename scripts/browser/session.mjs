// Synthetic identities only. These tokens are accepted solely by the local fixture.
export const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.test',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T00:00:00Z',
};
export function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    user,
    access_token: [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, exp, aud: 'authenticated' },
      'synthetic',
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.'),
    refresh_token: 'synthetic-refresh',
    expires_in: 3600,
    expires_at: exp,
    token_type: 'bearer',
  };
}
