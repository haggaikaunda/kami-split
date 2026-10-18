import { test, expect } from './fixtures.mjs';
import { responseFor } from './data.mjs';

const people = ['You', 'Alex', 'Jamie', 'Morgan', 'Sam'].map(
  (displayName, i) => ({
    id: `member-${i}`,
    displayName,
    role: i === 0 ? 'OWNER' : 'MEMBER',
    status: i === 4 ? 'INACTIVE' : 'ACTIVE',
    canParticipate: i !== 4,
  }),
);
const invitation = {
  id: 'invite-robin',
  kind: 'TARGETED',
  recipient: 'robin@example.test',
  expiresAt: '2026-12-01T00:00:00Z',
  lifecycle: 'PENDING',
  actionID: 'original-email-action',
  delivery: 'UNKNOWN',
};
const workspaces = [
  {
    name: 'Household',
    path: '/household',
    id: 'H',
    read: 'householdMembersQuery',
  },
  { name: 'Group', path: '/groups/F', id: 'F', read: 'journeyWorkspaceQuery' },
  { name: 'Trip', path: '/trips/T', id: 'T', read: 'journeyWorkspaceQuery' },
];

async function membersFixture(context, workspace) {
  const state = {
    owner: true,
    people,
    failure: false,
    denied: false,
    calls: [],
  };
  await context.route('**/api/graphql', async (route) => {
    const { query, variables } = route.request().postDataJSON();
    if (query.includes('ownerInvitations(')) {
      state.calls.push({ name: 'ownerInvitations', variables });
      return route.fulfill({
        json: {
          data: {
            ownerInvitations: {
              __typename: 'OwnerInvitationPage',
              items: [
                invitation,
                { ...invitation, id: 'accepted', lifecycle: 'ACCEPTED' },
              ],
              nextCursor: null,
            },
          },
        },
      });
    }
    if (query.includes('retryInvitationDelivery(')) {
      state.calls.push({ name: 'retryInvitationDelivery', variables });
      return route.fulfill({
        json: {
          data: {
            retryInvitationDelivery: {
              __typename: 'InvitationDeliveryResult',
              status: 'PROVIDER_ACCEPTED',
            },
          },
        },
      });
    }
    const name = query.match(/(?:query|mutation) (\w+)/)?.[1];
    if (name !== workspace.read) return route.fallback();
    if (state.gate) {
      state.started.resolve();
      await state.gate.promise;
    }
    if (state.failure) return route.fulfill({ status: 503, json: {} });
    const group = responseFor('journeyGroupQuery', { id: workspace.id }).group;
    group.members = state.people;
    group.viewerMembership = {
      ...people[state.owner ? 0 : 1],
      role: state.owner ? 'OWNER' : 'MEMBER',
    };
    if (workspace.id === 'T') group.name = 'Maui';
    const data =
      name === 'journeyWorkspaceQuery' ? responseFor(name, variables) : {};
    data.group = state.denied
      ? { __typename: 'Problem', code: 'FORBIDDEN' }
      : group;
    return route.fulfill({ json: { data } });
  });
  state.hold = () => {
    state.gate = Promise.withResolvers();
    state.started = Promise.withResolvers();
    return {
      started: state.started.promise,
      release() {
        state.gate.resolve();
        state.gate = null;
      },
    };
  };
  return state;
}

for (const workspace of workspaces) {
  test(`${workspace.name} Members keeps compact people, invitations and owner controls distinct`, async ({
    page,
    app,
    context,
  }, testInfo) => {
    const state = await membersFixture(context, workspace);
    await app.authenticate();
    await page.setViewportSize({
      width: testInfo.project.use.viewport.width,
      height: 844,
    });
    await page.goto(`${workspace.path}?tab=members`);
    const list = page.getByRole('list', { name: 'People', exact: true });
    await expect(list.locator('li')).toHaveCount(5);
    await expect(
      page.getByText('4 active members', { exact: true }),
    ).toBeVisible();
    await expect(list.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(
      list.getByText(/Member · No access\s+Retained in history/),
    ).toBeVisible();
    const heading = page.locator('[data-ui~="members-heading"]');
    const invite = heading.getByRole('button', { name: 'Invite', exact: true });
    await expect(invite).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (node) => {
        const { x, y, width, height, bottom } = node.getBoundingClientRect();
        return { x, y, width, height, bottom };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        typography: Object.fromEntries(
          ['member-name', 'member-detail', 'member-state'].map((slot) => {
            const style = getComputedStyle(
              document.querySelector(`[data-ui="${slot}"]`),
            );
            return [
              slot,
              {
                size: style.fontSize,
                weight: style.fontWeight,
                lineHeight: style.lineHeight,
              },
            ];
          }),
        ),
        heading: rect(document.querySelector('[data-ui~="members-heading"]')),
        rows: [...document.querySelectorAll('[aria-label="People"] > li')].map(
          rect,
        ),
        navigation: rect(
          document.querySelector('[data-ui~="workspace-navigation-links"]'),
        ),
      };
    });
    expect(geometry.typography['member-name']).toEqual({
      size: '14px',
      weight: '400',
      lineHeight: '20.3px',
    });
    expect(geometry.typography['member-detail'].size).toBe('12px');
    expect(geometry.typography['member-state'].size).toBe('11px');
    if (geometry.viewport.width === 390) {
      expect(geometry.rows[0].y).toBeLessThanOrEqual(300);
      expect(geometry.rows[3].bottom).toBeLessThanOrEqual(
        geometry.navigation.y,
      );
      for (const row of geometry.rows.slice(0, 4)) {
        expect(row.height).toBeGreaterThanOrEqual(68);
        expect(row.height).toBeLessThanOrEqual(88);
      }
    }
    await testInfo.attach('members-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await page.screenshot({
      path: testInfo.outputPath('members.png'),
      fullPage: true,
    });
    const pending = page.getByRole('region', { name: 'Pending invitations' });
    await expect(
      pending.getByText('Invited · No access yet', { exact: true }),
    ).toBeVisible();
    await expect(
      pending.getByText(
        'Email delivery is uncertain. Check or retry the same email.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      list.getByText('robin@example.test', { exact: true }),
    ).toHaveCount(0);
    await invite.focus();
    await page.keyboard.press('Enter');
    await expect(invite).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByLabel('Invitee email address', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Joining shares the group’s ledger/),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(invite).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByLabel('Invitee email address', { exact: true }),
    ).toBeHidden();
    await pending.getByText('Invitation options', { exact: true }).click();
    await pending
      .getByRole('button', {
        name: 'Retry same email without renewing',
        exact: true,
      })
      .click();
    await expect
      .poll(
        () =>
          state.calls.filter((call) => call.name === 'retryInvitationDelivery')
            .length,
      )
      .toBe(1);
    expect(
      state.calls.find((call) => call.name === 'retryInvitationDelivery')
        .variables,
    ).toEqual({ actionID: 'original-email-action' });
    const history = page.locator('[data-ui~="invitation-history"]');
    await history.getByText('Invitation history', { exact: true }).click();
    await expect(
      history.getByText('Accepted', { exact: true }).first(),
    ).toBeVisible();
    if (workspace.id !== 'H') {
      const settings = page.getByText('Group settings', { exact: true });
      await settings.click();
      await expect(
        page.getByText(/Metadata editing is not available/),
      ).toBeVisible();
    }
    const ownerReads = state.calls.length;
    state.owner = false;
    await page.reload();
    await expect(list.locator('li')).toHaveCount(5);
    await expect(
      page.getByRole('button', { name: 'Invite', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('Group settings', { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(/Ask the owner to invite someone/),
    ).toBeVisible();
    expect(state.calls.length).toBe(ownerReads);
  });

  test(`${workspace.name} Members clears private names during refresh, error and access loss`, async ({
    page,
    app,
    context,
  }) => {
    const state = await membersFixture(context, workspace);
    await app.authenticate();
    await page.goto(`${workspace.path}?tab=members`);
    await expect(
      page.getByRole('list', { name: 'People', exact: true }),
    ).toBeVisible();
    const hold = state.hold();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await hold.started;
    await expect(page.getByText('Jamie', { exact: true })).toHaveCount(0);
    state.failure = true;
    hold.release();
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByText('Jamie', { exact: true })).toHaveCount(0);
    state.failure = false;
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Jamie', { exact: true })).toBeVisible();
    state.denied = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('list', { name: 'People', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('Jamie', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('robin@example.test', { exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/sign-in' &&
        url.searchParams.get('auth') === 'unavailable',
    );
    await expect(
      page.getByRole('link', { name: 'retry account access', exact: true }),
    ).toBeVisible();
  });
}

for (const workspace of workspaces) {
  test(`${workspace.name} Members reflows long names, themes, enlarged text and empty data`, async ({
    page,
    app,
    context,
  }, testInfo) => {
    const state = await membersFixture(context, workspace);
    await app.authenticate();
    const observations = [];
    for (const [index, width] of [320, 390, 440, 1280].entries()) {
      for (const scale of [1, 2]) {
        const theme = ['LIGHT', 'DARK', 'SYSTEM'][(index + scale) % 3];
        app.setAppearance(theme);
        await page.emulateMedia({ colorScheme: 'dark' });
        state.people =
          scale === 2
            ? people.map((person, i) => ({
                ...person,
                displayName:
                  i === 1
                    ? 'AlexandriaWithAnUnbrokenVeryLongHistoricalName And A Long Family Name'
                    : person.displayName,
              }))
            : people;
        await page.setViewportSize({
          width,
          height: width === 320 && scale === 2 ? 500 : 844,
        });
        await page.goto(`${workspace.path}?tab=members`);
        await expect(
          page.getByRole('list', { name: 'People', exact: true }).locator('li'),
        ).toHaveCount(5);
        await expect(
          page.getByRole('button', { name: 'Invite', exact: true }),
        ).toBeVisible();
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        const geometry = await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          scrollWidth: document.documentElement.scrollWidth,
          font: getComputedStyle(document.documentElement).fontSize,
          theme: document.documentElement.dataset.theme,
          rows: [
            ...document.querySelectorAll('[aria-label="People"] > li'),
          ].map((row) => {
            const state = row.querySelector('[data-ui="member-state"]');
            const name = row.querySelector('[data-ui="member-name"]');
            const rect = row.getBoundingClientRect();
            return {
              height: rect.height,
              right: rect.right,
              stateRight: state.getBoundingClientRect().right,
              nameScroll: name.scrollWidth,
              nameWidth: name.clientWidth,
            };
          }),
        }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
        expect(geometry.font).toBe(scale === 2 ? '32px' : '16px');
        expect(geometry.theme).toBe(theme === 'LIGHT' ? 'light' : 'dark');
        for (const row of geometry.rows)
          expect(row.stateRight).toBeLessThanOrEqual(row.right + 1);
        observations.push({ width, scale, theme, geometry });
        const invite = page.getByRole('button', {
          name: 'Invite',
          exact: true,
        });
        await invite.focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByLabel('Invitee email address', { exact: true }),
        ).toBeVisible();
        await invite.click();
        await expect(invite).toHaveAttribute('aria-expanded', 'false');
        await page.screenshot({
          path: testInfo.outputPath(`members-${width}-${scale}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    state.people = [];
    await page.reload();
    await expect(
      page.getByText('0 active members', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('No members to display.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'People', exact: true }).locator('li'),
    ).toHaveCount(0);
    await testInfo.attach('members-reflow', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    });
  });
}
