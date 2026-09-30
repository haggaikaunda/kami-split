import { proxy } from '@/lib/onboarding/proxy';
export async function POST(request: Request) {
  return proxy(request, '/graphql');
}
