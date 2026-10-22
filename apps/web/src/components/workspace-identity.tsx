'use client';

import { cx } from './ui/classnames';

import Link from 'next/link';
import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react';
import { useFinancialSession } from './groups/session';
import { ScopedLink } from './groups/navigation';
import { useExpenseEntry } from './expenses/entry';
import { usePathname } from 'next/navigation';
import uiStyles from './ui/primitives.module.css';
import shellStyles from './workspace/shell.module.css';

// Reference icon geometry: Lucide1.17.0 (ISC/MIT); see LUCIDE-LICENSE.txt.
// The existing leaf brand remains unchanged.
const icons = {
  lock: (
    <>
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="10" width="18" height="12" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M7 5V3h10v2M16 15h2" />
    </>
  ),
  leaf: <path d="M20 3C10 2 3 6 4 14c1 7 13 8 16-11ZM3 21 16 8" />,
  pie: (
    <>
      <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" />
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </>
  ),
  'arrow-up-right': (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  invite: (
    <>
      <path d="M2 21a8 8 0 0 1 13.292-6" />
      <circle cx="10" cy="8" r="5" />
      <path d="M19 16v6" />
      <path d="M22 19h-6" />
    </>
  ),
  home: (
    <>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  groups: (
    <>
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </>
  ),
  trip: (
    <>
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </>
  ),
  expense: (
    <>
      <path d="M13 16H8" />
      <path d="M14 8H8" />
      <path d="M16 12H8" />
      <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />
    </>
  ),
  groceries: (
    <>
      <path d="m15 11-1 9" />
      <path d="m19 11-4-7" />
      <path d="M2 11h20" />
      <path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4" />
      <path d="M4.5 15.5h15" />
      <path d="m5 11 4-7" />
      <path d="m9 11 1 9" />
    </>
  ),
  dining: (
    <>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </>
  ),
  bed: (
    <>
      <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
      <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      <path d="M12 4v6" />
      <path d="M2 18h20" />
    </>
  ),
  car: (
    <>
      <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
      <path d="M7 14h.01" />
      <path d="M17 14h.01" />
      <rect width="18" height="8" x="3" y="10" rx="2" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </>
  ),
  activity: (
    <>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </>
  ),
  other: (
    <>
      <path d="M13 16H8" />
      <path d="M14 8H8" />
      <path d="M16 12H8" />
      <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />
    </>
  ),
  filter: (
    <>
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </>
  ),
  list: (
    <>
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  check: (
    <>
      <path d="M20 6 9 17l-5-5" />
    </>
  ),
  edit: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  moon: (
    <>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </>
  ),
  monitor: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </>
  ),
  signout: (
    <>
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </>
  ),
  sliders: (
    <>
      <path d="M10 5H3" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M16 17v4" />
      <path d="M21 12h-9" />
      <path d="M21 19h-5" />
      <path d="M21 5h-7" />
      <path d="M8 10v4" />
      <path d="M8 12H3" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  settings: (
    <>
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  calendar: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </>
  ),
} as const;
export type IconName = keyof typeof icons;
export function AppIcon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      data-ui={`icon`}
      className={cx(uiStyles['icon'], className)}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <span data-ui="workspace-brand" className={shellStyles['workspace-brand']}>
      <AppIcon name="leaf" />
      <span>Kami Grow</span>
    </span>
  );
}
/** Keep the compact phone caption and the full desktop action in one owner. */
export function ExpenseActionLabel() {
  return (
    <span aria-hidden="true">
      <span className={shellStyles['expense-label-full']}>Add expense</span>
      <span className={shellStyles['expense-label-short']}>Expense</span>
    </span>
  );
}
function subscribeNavigationLayout(changed: () => void) {
  window.addEventListener('resize', changed);
  return () => window.removeEventListener('resize', changed);
}
const phoneNavigationLayout = () => window.innerWidth <= 600;
const initialNavigationLayout = () => true;
/** Static navigation never reads or retains private group data. */
export function WorkspaceNavigation({
  headerRef,
  actionRef,
  destination,
}: {
  headerRef?: Ref<HTMLDivElement>;
  actionRef?: Ref<HTMLDivElement>;
  destination?: ReactNode;
} = {}) {
  const { scope } = useFinancialSession();
  const expenseEntry = useExpenseEntry();
  const pathname = usePathname();
  const navigation = useRef<HTMLElement>(null);
  // The DOM follows the visible sequence so native keyboard navigation does too.
  // Stable keys move the existing action slot without replacing its portal target.
  const phone = useSyncExternalStore(
    subscribeNavigationLayout,
    phoneNavigationLayout,
    initialNavigationLayout,
  );
  useLayoutEffect(() => {
    const nav = navigation.current;
    const frame = nav?.closest('main');
    if (!nav || !frame) return;
    const root = document.documentElement;
    const brand = nav.querySelector<HTMLElement>(
      '[data-ui~="workspace-navigation-brand"]',
    )!;
    const links = nav.querySelector<HTMLElement>(
      '[data-ui~="workspace-navigation-links"]',
    )!;
    // Measure occupied space only. CSS owns positioning; visual-viewport
    // panning, browser toolbars and pinch zoom must not move global chrome.
    const update = () => {
      const header = ['sticky', 'fixed'].includes(
        getComputedStyle(brand).position,
      )
        ? brand.getBoundingClientRect().height
        : 0;
      const footer =
        window.innerWidth <= 600 ? links.getBoundingClientRect().height : 0;
      frame.style.setProperty('--chrome-header', `${header}px`);
      frame.style.setProperty('--chrome-footer', `${footer}px`);
      root.style.setProperty('--chrome-header', `${header}px`);
      root.style.setProperty('--chrome-footer', `${footer}px`);
    };
    update();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(brand);
    observer?.observe(links);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--chrome-header');
      root.style.removeProperty('--chrome-footer');
    };
  }, []);
  const household =
    pathname === '/household' || pathname.startsWith('/household/');
  const personal =
    pathname === '/personal' || pathname.startsWith('/personal/');
  const profile = pathname.startsWith('/account');
  const trip = pathname.startsWith('/trips/');
  const groups =
    pathname === '/groups' ||
    pathname.startsWith('/groups/') ||
    pathname === '/trips' ||
    trip;
  const subtitle =
    destination ??
    (profile
      ? 'Profile'
      : household
        ? 'Household'
        : personal
          ? 'Personal'
          : groups
            ? 'Groups'
            : 'Workspace');
  const add = scope ? (
    <ScopedLink
      scope={scope}
      id="workspace-add"
      href="/household/expenses?create=choose"
      aria-label="Add expense"
      onClick={(event) => expenseEntry?.activate(event, '')}
    >
      <AppIcon name="plus" />
      <ExpenseActionLabel />
    </ScopedLink>
  ) : (
    <Link href="/household/expenses?create=choose" aria-label="Add expense">
      <AppIcon name="plus" />
      <ExpenseActionLabel />
    </Link>
  );
  const addSlot = (
    <div
      key="add"
      ref={actionRef}
      data-ui="workspace-add-slot"
      className={shellStyles['workspace-add-slot']}
    >
      {actionRef ? (
        <span
          aria-disabled="true"
          aria-label="Add expense"
          className={shellStyles['workspace-add-pending']}
        >
          <AppIcon name="plus" />
          <ExpenseActionLabel />
        </span>
      ) : (
        add
      )}
    </div>
  );
  const groupsLink = (
    <Link
      key="groups"
      href="/groups"
      aria-current={groups ? 'page' : undefined}
    >
      <span
        data-ui="workspace-navigation-icon"
        className={shellStyles['workspace-navigation-icon']}
      >
        <AppIcon name="groups" />
      </span>
      <span>Groups</span>
    </Link>
  );
  return (
    <nav
      ref={navigation}
      data-ui="workspace-navigation"
      className={shellStyles['workspace-navigation']}
      aria-label="Financial navigation"
    >
      <div
        data-ui="workspace-navigation-brand"
        className={cx(
          shellStyles['workspace-navigation-brand'],
          trip && shellStyles['workspace-navigation-brand--trip'],
        )}
      >
        <div className={shellStyles['workspace-navigation-identity']}>
          <Brand />
          <div
            ref={headerRef}
            data-destination={trip ? 'Trip' : 'Group'}
            className={shellStyles['workspace-navigation-destination']}
          >
            {!headerRef && subtitle}
          </div>
        </div>
      </div>
      <div
        data-ui="workspace-navigation-links"
        className={shellStyles['workspace-navigation-links']}
      >
        <Link href="/household" aria-current={household ? 'page' : undefined}>
          <span
            data-ui="workspace-navigation-icon"
            className={shellStyles['workspace-navigation-icon']}
          >
            <AppIcon name="home" />
          </span>
          <span>Household</span>
        </Link>
        <Link href="/personal" aria-current={personal ? 'page' : undefined}>
          <span
            data-ui="workspace-navigation-icon"
            className={shellStyles['workspace-navigation-icon']}
          >
            <AppIcon name="wallet" />
          </span>
          <span>Personal</span>
        </Link>
        {phone ? [addSlot, groupsLink] : [groupsLink, addSlot]}
        {scope && !profile ? (
          <ScopedLink
            scope={scope}
            id="workspace-account"
            href="/account"
            className={shellStyles['workspace-account']}
            onClick={(event) => expenseEntry?.activate(event, '')}
          >
            <span
              data-ui="workspace-navigation-icon"
              className={shellStyles['workspace-navigation-icon']}
            >
              <AppIcon name="account" />
            </span>
            <span>Account</span>
          </ScopedLink>
        ) : (
          <Link
            id="workspace-account"
            href="/account"
            className={shellStyles['workspace-account']}
            aria-current={profile ? 'page' : undefined}
          >
            <span
              data-ui="workspace-navigation-icon"
              className={shellStyles['workspace-navigation-icon']}
            >
              <AppIcon name="account" />
            </span>
            <span>Account</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
