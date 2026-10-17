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
    let appearance = 'LIGHT';
    const errors = [];
    const holds = [];
    const responses = [];
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
      const response = responses.find(
        (item) => item.operation === operation && item.matches(variables),
      );
      const hold = holds.find(
        (item) => !item.claimed && item.operation === operation,
      );
      let data;
      if (response) {
        data = response.data;
        response.started.resolve();
        await response.released.promise;
      } else if (!hold && operation === 'appearanceMutation') {
        expect(variables.expectedAppearance).toBe(appearance);
        appearance = variables.appearance;
        data = { updateMyAppearance: { __typename: 'Profile', appearance } };
      } else {
        data = hold?.data ?? responseFor(operation, variables);
        if (!hold && data.currentProfile)
          data.currentProfile.appearance = appearance;
      }
      if (hold) {
        hold.claimed = true;
        hold.started.resolve();
        await hold.released.promise;
      }
      // Model an asynchronous service, as in the retained navigation fixture.
      await delay(100);
      try {
        await route.fulfill({
          json: { data },
          status: response?.status ?? hold?.status ?? 200,
        });
      } catch (error) {
        // Disposed account requests can be canceled while deliberately held.
        if (!hold && !response) throw error;
      } finally {
        hold?.finished.resolve();
      }
    });
    try {
      await runTest({
        requests,
        setAppearance(value) {
          appearance = value;
        },
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
        hold(operation, data, { status = 200 } = {}) {
          const item = {
            operation,
            data,
            status,
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
        // Model persistent server state across canceled/replacement requests.
        // Every matching read waits for release, then receives the same state.
        holdMatching(operation, matches, data, { status = 200 } = {}) {
          const item = {
            operation,
            matches,
            data,
            status,
            started: Promise.withResolvers(),
            released: Promise.withResolvers(),
          };
          responses.push(item);
          return {
            started: item.started.promise,
            release() {
              item.released.resolve();
            },
          };
        },
      });
    } finally {
      for (const hold of holds) hold.released.resolve();
      for (const response of responses) response.released.resolve();
      await context.unrouteAll({ behavior: 'wait' });
    }
    expect(errors, 'Uncaught browser errors').toEqual([]);
  },
});
