// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScope } from '@/lib/relay/environment';
import { BalanceSection, ObligationRows } from './balance-sections';

vi.mock('./navigation', () => ({
  ScopedLink: ({
    children,
    href,
    id,
    className,
    'aria-label': label,
  }: {
    children: React.ReactNode;
    href: string;
    id: string;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a href={href} id={id} className={className} aria-label={label}>
      {children}
    </a>
  ),
}));
let root: Root, host: HTMLDivElement, scope: ReturnType<typeof createScope>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  scope = createScope({} as SupabaseClient, 'actor');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  scope.dispose();
});

it('starts many sources collapsed, expands independently and preserves only metadata across a return', async () => {
  const sources = () => (
    <>
      {Array.from({ length: 20 }, (_, i) => (
        <BalanceSection
          scope={scope}
          identity={`source-${i}`}
          key={i}
          summary={`Space ${i}: balance unavailable`}
        >
          <p>Authorized detail {i}</p>
        </BalanceSection>
      ))}
    </>
  );
  await act(async () => root.render(sources()));
  const details = [...host.querySelectorAll('details')];
  expect(details.every((detail) => !detail.open)).toBe(true);
  await act(async () => {
    details[0].open = true;
    details[0].dispatchEvent(new Event('toggle', { bubbles: true }));
    details[19].open = true;
    details[19].dispatchEvent(new Event('toggle', { bubbles: true }));
  });
  expect(details[1].open).toBe(false);
  expect(
    details[19].querySelector('summary')?.getAttribute('aria-expanded'),
  ).toBe('true');
  await act(async () => root.render(null));
  await act(async () => root.render(sources()));
  expect(
    [...host.querySelectorAll('details')].map((detail) => detail.open),
  ).toEqual(Array.from({ length: 20 }, (_, i) => i === 0 || i === 19));
  expect(
    [...scope.balanceExpansions.values()].every(
      (value) => typeof value === 'boolean',
    ),
  ).toBe(true);
  scope.dispose();
  expect(scope.balanceExpansions.size).toBe(0);
});

it.each([
  [false, 'ORDINARY', '/groups/G/repayments/new?'],
  [false, 'TRIP', '/trips/G/repayments/new?'],
  [true, 'ORDINARY', '/household/ledger?tab=balances&repayment=1&'],
])(
  'uses explicit obligations in both directions and the original source route (%s, %s)',
  async (isHousehold, kind, prefix) => {
    const viewer = { id: 'viewer', displayName: 'You Person' };
    const other = { id: 'other', displayName: 'Long Counterparty Name' };
    const third = { id: 'third', displayName: 'Another Counterparty' };
    await act(async () =>
      root.render(
        <ObligationRows
          scope={scope}
          space={{
            id: 'G',
            name: 'Original source',
            currency: 'USD',
            isHousehold,
            kind,
          }}
          viewer={viewer.id}
          obligations={[
            { from: viewer, to: other, amountMinor: '401' },
            { from: third, to: viewer, amountMinor: '599' },
            { from: other, to: third, amountMinor: '9007199254740993' },
          ]}
          eligible={() => true}
        />,
      ),
    );
    const links = [...host.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `${prefix}sender=viewer&recipient=other&amount=401`,
      `${prefix}sender=third&recipient=viewer&amount=599`,
      `${prefix}sender=other&recipient=third&amount=9007199254740993`,
    ]);
    expect(
      links[0].querySelector('[data-ui~="repayment-row"]')?.textContent,
    ).toContain('You (You Person) pays Long Counterparty Name');
    expect(links[1].textContent).toContain('Record repayment:');
    expect(links[1].textContent).toContain(
      'Another Counterparty pays You (You Person)',
    );
    expect(links[1].textContent).toContain('Original source');
    expect(links[1].textContent).toContain('$5.99');
    for (const link of links) {
      expect(link.querySelector('a, button, input, [tabindex="0"]')).toBeNull();
      expect(
        link.querySelector('[data-ui~="repayment-row"]')?.textContent,
      ).not.toContain('Record repayment');
    }
  },
);

it('retains ineligible historical obligations as readable rows without granting recording', async () => {
  await act(async () =>
    root.render(
      <ObligationRows
        scope={scope}
        space={{
          id: 'G',
          name: 'Original source',
          currency: 'USD',
          isHousehold: false,
        }}
        viewer="viewer"
        obligations={[
          {
            from: { id: 'historical', displayName: 'Former Member' },
            to: { id: 'viewer', displayName: 'Viewer' },
            amountMinor: '1000',
          },
        ]}
        eligible={(id) => id !== 'historical'}
      />,
    ),
  );
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Former Member pays You (Viewer)');
  expect(host.textContent).toContain(
    'Recording requires two currently eligible members.',
  );
});
