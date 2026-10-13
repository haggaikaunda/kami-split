import { resolve } from 'node:path';

function port(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error(`${name} must be a port between 1024 and 65535`);
  return Number(value);
}
export const webPort = port('BROWSER_PORT', '3295');
export const authPort = port('BROWSER_AUTH_PORT', '3296');
if (webPort === authPort) throw new Error('Browser and Auth ports must differ');
export const origin = `http://127.0.0.1:${webPort}`;
export const authOrigin = `http://127.0.0.1:${authPort}`;
export const output = resolve(
  process.env.BROWSER_OUTPUT_DIR || 'test-results/browser',
);
