export function GET() {
  const url = process.env.ONBOARDING_PUBLIC_SUPABASE_URL;
  const key = process.env.ONBOARDING_PUBLIC_SUPABASE_KEY;
  if (!url || !key)
    return Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
  return Response.json(
    { url, key },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
