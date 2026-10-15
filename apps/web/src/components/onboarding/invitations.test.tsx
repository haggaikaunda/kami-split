// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InvitationPanel } from './invitations';
import type { OnboardingController } from './controller';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const members = [
  { id: 'a', displayName: 'Alice', role: 'OWNER', status: 'ACTIVE' },
  { id: 'b', displayName: 'Bob', role: 'MEMBER', status: 'INACTIVE' },
];
function invitation(id: string, lifecycle: string, kind = 'TARGETED') {
  return {
    id,
    lifecycle,
    kind,
    recipient: kind === 'SHARED' ? null : `${id}@example.test`,
    expiresAt: '2026-12-01T00:00:00Z',
    actionID: `action-${id}`,
    delivery: 'UNKNOWN',
  };
}
function controller(invites: OnboardingController['invites']) {
  return {
    group: 'group',
    invites,
    busy: false,
    attempt: null,
    email: '',
    setEmail: vi.fn(),
    ownerAction: vi.fn(),
    run: async (action: () => Promise<unknown>) => action(),
    loadInvites: vi.fn(),
    send: vi.fn(),
  } as unknown as OnboardingController;
}
it('keeps membership identities and pending recipients together, with terminal records only in collapsed history', async () => {
  const c = controller([
    invitation('carol', 'PENDING'),
    invitation('alice', 'ACCEPTED'),
    invitation('expired', 'EXPIRED'),
    invitation('revoked', 'REVOKED'),
    invitation('shared', 'PENDING', 'SHARED'),
    invitation('old-shared', 'EXPIRED', 'SHARED'),
  ]);
  await act(async () =>
    root.render(<InvitationPanel state={c} members={members} />),
  );
  const people = host.querySelector('[aria-label="People"]')!;
  expect(people.children).toHaveLength(3);
  expect(people.textContent).toContain('Alice');
  expect(people.textContent).toContain('Owner · Active');
  expect(people.textContent).toContain('Bob');
  expect(people.textContent).toContain(
    'Inactive · No access; retained in history',
  );
  expect(people.textContent).toContain('carol@example.test');
  expect(people.textContent).toContain('Pending · Invitation only; no access');
  expect(people.textContent).not.toContain('alice@example.test');
  expect(people.textContent).not.toContain('Shared group link');
  const history = host.querySelector(
    '[data-ui~="invitation-history"]',
  ) as HTMLDetailsElement;
  expect(history.open).toBe(false);
  expect(history.querySelectorAll('li')).toHaveLength(4);
  expect(history.textContent).toContain('Accepted');
  expect(history.textContent).toContain('Cancelled');
  expect(history.textContent).toContain('Expired');
  expect(
    host.querySelector('[aria-label="Shared invitation links"]')?.textContent,
  ).toContain('Available');
  expect(host.textContent).not.toMatch(
    /UNKNOWN|PROVIDER_ACCEPTED|REVOKED|NOT_REQUESTED/,
  );
  expect(
    (host.querySelector('[data-ui~="add-member"]') as HTMLDetailsElement).open,
  ).toBe(false);
});
it('retains exact invitation identity for renewal, revocation, email retry and pagination', async () => {
  const c = controller([
    invitation('expired', 'EXPIRED', 'SHARED'),
    invitation('pending', 'PENDING'),
  ]);
  c.next = 'cursor';
  await act(async () =>
    root.render(<InvitationPanel state={c} members={members} />),
  );
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === label,
    )!;
    await act(async () => button.click());
  };
  await click('Renew shared link for seven days');
  expect(c.ownerAction).toHaveBeenCalledWith('RENEW_SHARED', 'expired');
  await click('Revoke invitation');
  expect(c.ownerAction).toHaveBeenCalledWith('REVOKE', 'pending');
  await click('Retry same email without renewing');
  expect(c.send).toHaveBeenCalledWith('action-pending');
  expect(c.loadInvites).toHaveBeenCalledWith('group');
  await click('Load more invitations');
  expect(c.loadInvites).toHaveBeenCalledWith('group', 'cursor');
});
it('an accepted reactivation uses the returned member identity rather than adding an invite person', async () => {
  const c = controller([invitation('bob', 'PENDING')]);
  await act(async () =>
    root.render(<InvitationPanel state={c} members={members} />),
  );
  expect(host.querySelector('[aria-label="People"]')?.children).toHaveLength(3);
  c.invites = [invitation('bob', 'ACCEPTED')];
  await act(async () =>
    root.render(
      <InvitationPanel
        state={c}
        members={members.map((m) => ({ ...m, status: 'ACTIVE' }))}
      />,
    ),
  );
  const people = host.querySelector('[aria-label="People"]')!;
  expect(people.children).toHaveLength(2);
  expect(people.textContent).toContain('Bob');
  expect(people.textContent).not.toContain('Inactive');
  expect(people.textContent).not.toContain('bob@example.test');
});
