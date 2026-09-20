import { describe, expect, it } from 'vitest';
import { greeting } from './greeting';

describe('greeting', () => {
  it('greets the world by default', () => {
    expect(greeting()).toBe('Hello, world!');
  });

  it('greets a named person', () => {
    expect(greeting('Kami')).toBe('Hello, Kami!');
  });
});
