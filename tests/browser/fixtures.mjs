import { setTimeout as delay } from 'node:timers/promises';
import { test as base, expect } from '@playwright/test';
import { origin } from '../../scripts/browser/settings.mjs';
import { session, user } from '../../scripts/browser/session.mjs';
import { responseFor } from './data.mjs';

export { expect };
export const test = base.extend({
  // Each test has its own context, route state, request log and pending responses.
  app: async ({ context }, runTest) => {
    const requests = [];
    const errors = [];
    const holds = [];
    const observe = (page) =>
      page.on('pageerror', (error) => errors.push(error.message));
    context.on('page', observe);
    context.pages().forEach(observe);
    await context.route('**/api/onboarding/clear', (route) =>
      route.fulfill({ json: { code: 'CLEARED' } }),
    );
    await context.route('**/api/graphql', async (route) => {
      const { query, variables } = route.request().postDataJSON();
      const operation = query.match(/(?:query|mutation) (\w+)/)?.[1];
      requests.push({ operation, variables });
      const data = responseFor(operation, variables);
      const hold = holds.find(
        (item) => !item.claimed && item.operation === operation,
      );
      if (hold) {
        hold.claimed = true;
        hold.started.resolve();
        await hold.released.promise;
      }
      // Model an asynchronous service, as in the retained navigation fixture.
      await delay(100);
      try {
        await route.fulfill({ json: { data } });
      } catch (error) {
        // Disposed account requests can be canceled while deliberately held.
        if (!hold) throw error;
      } finally {
        hold?.finished.resolve();
      }
    });
    try {
      await runTest({
        requests,
        async authenticate() {
          await context.addCookies([
            {
              name: 'kami-auth',
              value:
                'base64-' +
                Buffer.from(JSON.stringify(session())).toString('base64url'),
              url: origin,
              sameSite: 'Lax',
            },
          ]);
        },
        async signIn(page) {
          await page
            .getByLabel('Email address', { exact: true })
            .fill(user.email);
          await page
            .getByLabel('Password', { exact: true })
            .fill('SyntheticPassword123');
          await page
            .getByRole('button', { name: 'Sign in', exact: true })
            .click();
        },
        hold(operation) {
          const item = {
            operation,
            started: Promise.withResolvers(),
            released: Promise.withResolvers(),
            finished: Promise.withResolvers(),
          };
          holds.push(item);
          return {
            started: item.started.promise,
            async release() {
              item.released.resolve();
              await item.finished.promise;
            },
          };
        },
      });
    } finally {
      for (const hold of holds) hold.released.resolve();
      await context.unrouteAll({ behavior: 'wait' });
    }
    expect(errors, 'Uncaught browser errors').toEqual([]);
  },
});
