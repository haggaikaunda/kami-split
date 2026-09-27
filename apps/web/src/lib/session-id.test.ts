import { afterEach, expect, it, vi } from 'vitest';
import { createSessionId } from './session-id';

afterEach(() => vi.unstubAllGlobals());

it('uses the native UUID generator when available', () => {
  const randomUUID = vi.fn(() => '83a439bc-3483-40ed-a8b3-204c72c80db6');
  vi.stubGlobal('crypto', { randomUUID });
  expect(createSessionId()).toBe('83a439bc-3483-40ed-a8b3-204c72c80db6');
  expect(randomUUID).toHaveBeenCalledOnce();
});

it('uses cryptographic bytes and sets only UUID version/variant bits on HTTP', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.set(Array.from({ length: 16 }, (_, index) => 240 + index));
    return bytes;
  });
  vi.stubGlobal('crypto', { getRandomValues });
  expect(createSessionId()).toBe('f0f1f2f3-f4f5-46f7-b8f9-fafbfcfdfeff');
  expect(getRandomValues).toHaveBeenCalledOnce();
  expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
});

it('generates distinct well-formed fallback identifiers for separate operations', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const ids = Array.from({ length: 100 }, createSessionId);
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) {
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});
