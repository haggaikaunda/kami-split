import { expect, it, vi } from 'vitest';
import Home from './page';

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

it('enters real authenticated discovery without rendering financial data', () => {
  expect(() => Home()).toThrow('NEXT_REDIRECT:/groups');
});
