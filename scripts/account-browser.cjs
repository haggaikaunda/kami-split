/* eslint-disable @typescript-eslint/no-require-imports -- Standalone fixture browser runner. */
// Synthetic browser evidence; persistence/authorization are proved by db-test.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {
  authOrigin,
  seedSession,
  withAuthFixture,
} = require('./browser-auth-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = `http://localhost:${process.env.PORT || '3194'}`;
const output = process.env.OUTPUT_DIR || '/tmp/kami-account-browser';
fs.mkdirSync(output, { recursive: true });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.test',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T00:00:00Z',
};
const token = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: 'authenticated',
    }),
  ).toString('base64url'),
  'synthetic',
].join('.');
const session = {
  user,
  access_token: token,
  refresh_token: 'synthetic-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
};
const spaces = [
  { id: 'H', name: 'Household', kind: 'ORDINARY', isHousehold: true },
  { id: 'G', name: 'Friends', kind: 'ORDINARY', isHousehold: false },
  { id: 'T', name: 'Maui', kind: 'TRIP', isHousehold: false },
].map((g) => ({
  ...g,
  currency: 'USD',
  trip:
    g.kind === 'TRIP'
      ? { destination: 'Maui', startDate: '2026-10-01', endDate: '2026-10-08' }
      : null,
}));
withAuthFixture(origin, session, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const reports = [];
  try {
    for (const width of [320, 390, 768, 1280])
      for (const scale of [1, 2]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: 'reduce',
        });
        let name = 'Alex 王小明',
          signedOut = false,
          saveCount = 0,
          failedRead = false,
          failedLogout = false,
          uncertain = false,
          member = false;
        const errors = [],
          requests = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await seedSession(page.context(), origin, session);
        await page.route('**/api/onboarding-config', (r) =>
          r.fulfill({
            json: { url: authOrigin, key: 'synthetic-public' },
          }),
        );
        await page.route('**/api/onboarding/clear', (r) =>
          r.fulfill(
            failedLogout
              ? { status: 503, json: { code: 'UNAVAILABLE' } }
              : { json: { code: 'CLEARED' } },
          ),
        );
        await page.route(authOrigin + '/auth/v1/**', (r) => {
          if (r.request().url().includes('/logout')) {
            if (failedLogout)
              return r.fulfill({
                status: 500,
                json: { message: 'Unavailable' },
              });
            signedOut = true;
            return r.fulfill({ status: 204, body: '' });
          }
          return r.fulfill({
            json: r.request().url().includes('/user') ? user : session,
          });
        });
        await page.route('**/api/graphql', async (r) => {
          const { query, variables = {} } = r.request().postDataJSON();
          requests.push({ query, variables });
          if (signedOut)
            return r.fulfill({
              status: 401,
              json: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
            });
          const m = {
            id: 'M1',
            displayName: name,
            role: member ? 'MEMBER' : 'OWNER',
            status: 'ACTIVE',
            canParticipate: true,
          };
          const group = {
            __typename: 'Group',
            ...spaces.find((g) => g.id === (variables.id || 'G')),
            viewerMembership: m,
            members: [m],
            expenses: {
              revision: '0',
              edges: [],
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
            },
            repayments: { edges: [], pageInfo: { hasNextPage: false } },
            balances: {
              __typename: 'GroupBalances',
              revision: '0',
              totalExpenseMinor: '0',
              settled: true,
              positions: [
                {
                  member: m,
                  netMinor: '0',
                  paidMinor: '0',
                  owedMinor: '0',
                  sentMinor: '0',
                  receivedMinor: '0',
                },
              ],
              obligations: [],
            },
          };
          let data;
          if (query.includes('updateMyProfile')) {
            saveCount++;
            name = variables.displayName;
            if (uncertain) {
              uncertain = false;
              return r.abort('failed');
            }
            data = {
              updateMyProfile: {
                __typename: 'Profile',
                id: 'profile-v',
                displayName: name,
              },
            };
          } else if (query.includes('currentProfile'))
            data = {
              currentProfile: failedRead
                ? {
                    __typename: 'ProfileProblem',
                    code: 'UNAVAILABLE',
                    message: 'Unavailable',
                  }
                : {
                    __typename: 'Profile',
                    id: 'profile-v',
                    displayName: name,
                    appearance: 'SYSTEM',
                  },
            };
          else if (query.includes('ownerInvitations'))
            data = {
              ownerInvitations: {
                __typename: 'OwnerInvitationPage',
                items: [
                  {
                    id: 'I1',
                    kind: 'SHARED',
                    recipient: null,
                    expiresAt: '2026-10-13T00:00:00Z',
                    lifecycle: 'PENDING',
                    actionID: null,
                    delivery: 'NOT_REQUESTED',
                  },
                ],
                nextCursor: null,
              },
            };
          else if (
            query.includes('householdDashboard') &&
            !query.includes('group(id:')
          )
            data = {
              householdDashboard: {
                __typename: 'Problem',
                code: 'UNAVAILABLE',
                message: 'Unavailable',
              },
            };
          else
            data = {
              viewer: {
                __typename: 'Viewer',
                id: 'v',
                displayName: name,
                today: '2026-10-06',
                canCreateGroups: false,
                groups: spaces,
              },
              group,
            };
          return r.fulfill({ json: { data } });
        });
        const resize = async () => {
          await page.evaluate(
            (s) => (document.documentElement.style.fontSize = `${16 * s}px`),
            scale,
          );
          // Let the shell's ResizeObserver settle after changing actual text size.
          await page.waitForTimeout(100);
        };
        const capture = async (label) => {
          await resize();
          await page.screenshot({
            path: `${output}/${label}-${width}-${scale}.png`,
            fullPage: true,
          });
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            `${label}: overflow ${width}/${scale}`,
          );
        };
        await page.goto(origin + '/account');
        await page.getByLabel('Display name', { exact: true }).waitFor();
        await resize();
        assert.equal(
          await page
            .getByRole('navigation', { name: 'Financial navigation' })
            .getByRole('link', { name: 'Account' })
            .getAttribute('aria-current'),
          'page',
        );
        assert.equal(
          await page.getByRole('button', { name: 'Refresh groups' }).count(),
          0,
        );
        await capture('account');
        const draft = JSON.stringify({
          G: {
            version: 1,
            actor: user.id,
            group: 'G',
            draft: {
              description: 'Keep this expense draft',
              amount: '1.00',
              date: '2026-10-06',
              category: 'OTHER',
              note: '',
              payer: 'M1',
              participants: ['M1'],
              split: 'EQUAL',
              exact: {},
            },
            attempt: {
              groupId: 'G',
              key: '12345678-1234-4234-8234-123456789012',
              totalMinor: '100',
              currency: 'USD',
              description: 'Keep this expense draft',
              effectiveDate: '2026-10-06',
              category: 'OTHER',
              note: '',
              payerId: 'M1',
              participantIds: ['M1'],
              split: 'EQUAL',
            },
          },
        });
        await page.evaluate(
          (value) => sessionStorage.setItem('kami-financial-drafts-v1', value),
          draft,
        );

        await page
          .getByLabel('Display name', { exact: true })
          .fill(' María 王小明 🌻 ');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByText('Changes saved.', { exact: true }).waitFor();
        assert.equal(name, 'María 王小明 🌻');
        assert.equal(saveCount, 1);
        assert.equal(
          await page.evaluate(() =>
            sessionStorage.getItem('kami-financial-drafts-v1'),
          ),
          draft,
        );
        await page
          .getByLabel('Display name', { exact: true })
          .fill('王'.repeat(119) + '🌻');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByText('Changes saved.', { exact: true }).waitFor();
        await capture('account-long-name');
        assert.equal(
          await page.evaluate(() =>
            sessionStorage.getItem('kami-financial-drafts-v1'),
          ),
          draft,
        );

        await page.reload();
        await page.getByLabel('Display name', { exact: true }).waitFor();
        assert.equal(
          await page.getByLabel('Display name', { exact: true }).inputValue(),
          name,
        );
        uncertain = true;
        await page
          .getByLabel('Display name', { exact: true })
          .fill('Saved despite lost response');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page
          .getByRole('button', { name: 'Check current profile' })
          .waitFor();
        assert(
          await page.getByRole('button', { name: 'Save changes' }).isDisabled(),
        );
        await page
          .getByRole('button', { name: 'Check current profile' })
          .click();
        await page.getByText(/Current saved name:/).waitFor();
        await page
          .getByRole('link', { name: 'Household', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: 'Household workspace' })
          .getByRole('link', { name: 'Members', exact: true })
          .click();
        await page
          .getByRole('region', { name: 'People and invitations for Household' })
          .getByText('Shared group link', { exact: true })
          .waitFor();
        assert.equal(
          requests.filter((x) => x.query.includes('ownerInvitations')).at(-1)
            .variables.groupID,
          'H',
        );
        await capture('household-invitations');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );
        assert.equal(
          await page.evaluate(
            () => getComputedStyle(document.body).colorScheme,
          ),
          'dark',
        );
        await capture('household-invitations-dark');
        await page.emulateMedia({ colorScheme: 'light' });
        for (const [id, kind] of [
          ['G', 'groups'],
          ['T', 'trips'],
        ]) {
          await page.goto(`${origin}/${kind}/${id}?tab=members#invitations`);
          await page
            .getByRole('region', {
              name: `People and invitations for ${id === 'G' ? 'Friends' : 'Maui'}`,
            })
            .getByText('Shared group link', { exact: true })
            .waitFor();
          await capture(`${kind}-invitations`);
          assert.equal(
            requests.filter((x) => x.query.includes('ownerInvitations')).at(-1)
              .variables.groupID,
            id,
          );
          await page.reload();
          await page
            .getByRole('region', { name: /People and invitations for/ })
            .waitFor();
        }
        await page.goto(origin + '/invitations?group=T');
        await page.waitForURL('**/trips/T?tab=members#invitations');
        await page
          .getByRole('region', { name: 'People and invitations for Maui' })
          .waitFor();
        await page.goto(origin + '/invitations');
        await page
          .getByRole('heading', { name: 'Invitations have moved' })
          .waitFor();
        assert.equal(
          await page.getByRole('button', { name: 'Load my groups' }).count(),
          0,
        );
        member = true;
        await page.goto(origin + '/groups/G?tab=members');
        await page
          .getByRole('heading', { name: 'Members', exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole('region', { name: /People and invitations for/ })
            .count(),
          0,
        );
        member = false;
        failedRead = true;
        await page.goto(origin + '/account');
        await page.getByRole('button', { name: 'Retry profile' }).waitFor();
        assert.equal(await page.getByRole('navigation').count(), 1);
        await capture('profile-error');
        failedRead = false;
        await page.getByRole('button', { name: 'Retry profile' }).click();
        await page.getByLabel('Display name', { exact: true }).waitFor();
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === 'dark',
        );
        assert.equal(
          await page.evaluate(
            () => getComputedStyle(document.body).colorScheme,
          ),
          'dark',
        );
        const brandColor = await page
          .getByText('Kami Grow', { exact: true })
          .evaluate((element) => getComputedStyle(element).color);
        const darkContrast = await page.evaluate((brandColor) => {
          const luminance = (color) => {
            const rgb = color
              .match(/[0-9.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                v /= 255;
                return v <= 0.04045
                  ? v / 12.92
                  : Math.pow((v + 0.055) / 1.055, 2.4);
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const ratio = (a, b) => {
            const x = luminance(a),
              y = luminance(b);
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          const background = getComputedStyle(
            document.getElementById('profile-heading').closest('section'),
          ).backgroundColor;
          return {
            canvas: getComputedStyle(document.documentElement).backgroundColor,
            brand: ratio(brandColor, background),
            heading: ratio(
              getComputedStyle(document.querySelector('#profile-heading'))
                .color,
              background,
            ),
            label: ratio(
              getComputedStyle(
                document.querySelector('label[for="display-name"]'),
              ).color,
              background,
            ),
          };
        }, brandColor);
        assert.equal(darkContrast.canvas, 'rgb(11, 17, 27)');
        assert(
          darkContrast.heading >= 4.5 &&
            darkContrast.label >= 4.5 &&
            darkContrast.brand >= 4.5,
          'Dark inherited profile text must remain readable',
        );
        await capture('account-dark');
        await page.getByLabel('Display name', { exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          'account-email',
        );
        failedLogout = true;
        await page
          .getByRole('button', { name: 'Sign out of this session' })
          .click();
        await page.getByRole('alert').first().waitFor();
        assert(page.url().endsWith('/account'));
        failedLogout = false;
        await page
          .getByRole('button', { name: 'Sign out of this session' })
          .click();
        await page.waitForURL((url) => url.pathname === '/sign-in');
        await page.getByLabel('Email address', { exact: true }).waitFor();
        await capture('signed-out');
        assert.equal(
          await page.evaluate(() =>
            sessionStorage.getItem('kami-financial-drafts-v1'),
          ),
          null,
        );
        await page.goBack();
        assert.equal(
          await page.getByLabel('Display name', { exact: true }).count(),
          0,
        );
        await page.goto(origin + '/account');
        assert.equal(
          await page.getByLabel('Display name', { exact: true }).count(),
          0,
        );
        await page.reload();
        assert.equal(
          await page.getByLabel('Display name', { exact: true }).count(),
          0,
        );
        assert.deepEqual(errors, []);
        reports.push({ width, scale, saveCount, requests: requests.length });
        await page.close();
      }
    fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports));
  } finally {
    await browser.close();
  }
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
