import { proxy } from '@/lib/onboarding/proxy';
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (
    ![
      'start',
      'copy-shared',
      'preview',
      'provision',
      'recover',
      'callback-state',
      'accept',
      'clear',
    ].includes(action)
  )
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  return proxy(request, `/onboarding/${action}`);
}
