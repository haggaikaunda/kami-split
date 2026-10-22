'use client';
import focusStyles from '../ui/focus.module.css';
import workspaceStyles from './patterns.module.css';
import { cx } from '../ui/classnames';

import Link, { useLinkStatus } from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { AppIcon } from '../workspace-identity';
import { useLoadingPhase } from '../ui/loading';

/** Context belongs in the header; financial data stays on a plain surface. */
export function WorkspaceHeader({
  ref,
  title,
  context,
  children,
  appearance,
  compact = false,
}: {
  ref?: Ref<HTMLElement>;
  title: string;
  context?: ReactNode;
  children?: ReactNode;
  appearance?: 'household' | 'trip' | 'group' | 'personal';
  compact?: boolean;
}) {
  return (
    <header
      ref={ref}
      data-ui={
        `workspace-header ${appearance ? `workspace-header--${appearance}` : ''}${compact ? ' workspace-header--compact' : ''}` +
        ' form-region'
      }
      className={cx(
        workspaceStyles['workspace-header'],
        appearance && workspaceStyles[`workspace-header--${appearance}`],
        compact && workspaceStyles['workspace-header--compact'],
      )}
    >
      <div
        data-ui="workspace-title"
        className={workspaceStyles['workspace-title']}
      >
        {appearance && (
          <span
            data-ui="workspace-identity-icon"
            className={workspaceStyles['workspace-identity-icon']}
          >
            <AppIcon
              name={
                appearance === 'household'
                  ? 'home'
                  : appearance === 'trip'
                    ? 'trip'
                    : appearance === 'personal'
                      ? 'wallet'
                      : 'groups'
              }
            />
          </span>
        )}
        <div
          data-ui="workspace-heading"
          className={workspaceStyles['workspace-heading']}
        >
          <h1 data-page-heading tabIndex={-1}>
            {title}
          </h1>
          {context && (
            <div
              data-ui="workspace-context"
              className={workspaceStyles['workspace-context']}
            >
              {context}
            </div>
          )}
        </div>
      </div>
      {children}
    </header>
  );
}

export const workspaceSections = [
  'Overview',
  'Expenses',
  'Balances',
  'Activity',
  'Members',
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number];

/** Route navigation uses links and aria-current, rather than in-page tab semantics. */
export function WorkspaceTabs({
  current,
  hrefFor,
  label = 'Workspace',
}: {
  current: WorkspaceSection;
  hrefFor: (section: WorkspaceSection) => string;
  label?: string;
}) {
  return (
    <nav
      data-ui="workspace-tabs"
      className={cx(
        workspaceStyles['workspace-tabs'],
        focusStyles['pointer-navigation'],
      )}
      aria-label={label}
    >
      {workspaceSections.slice(0, 3).map((section) => (
        <Link
          scroll={false}
          key={section}
          href={hrefFor(section)}
          aria-current={current === section ? 'page' : undefined}
        >
          {section}
          <NavigationPending />
        </Link>
      ))}
      <MoreNavigation key={current} current={current} hrefFor={hrefFor} />
    </nav>
  );
}

function MoreNavigation({
  current,
  hrefFor,
}: {
  current: WorkspaceSection;
  hrefFor: (section: WorkspaceSection) => string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = current === 'Activity' || current === 'Members';
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={container} className={workspaceStyles['workspace-more']}>
      <button
        ref={trigger}
        type="button"
        aria-label={selected ? `More, current view: ${current}` : 'More'}
        aria-expanded={open}
        aria-controls={id}
        data-current={selected || undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              container.current?.querySelector('a')?.focus(),
            );
          }
        }}
      >
        {selected ? `More · ${current}` : 'More'}{' '}
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div id={id} className={workspaceStyles['workspace-more-panel']}>
          {(['Activity', 'Members'] as const).map((section) => (
            <Link
              key={section}
              scroll={false}
              href={hrefFor(section)}
              aria-current={current === section ? 'page' : undefined}
              onClick={() => {
                if (current === section) {
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              {section}
              <NavigationPending />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render inside a native route Link to share its delayed pending cue. */
export function NavigationPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      data-ui="workspace-navigation-pending"
      className={workspaceStyles['workspace-navigation-pending']}
      data-pending={pending || undefined}
      aria-hidden="true"
    >
      {pending && <PendingDot />}
    </span>
  );
}

function PendingDot() {
  const phase = useLoadingPhase();
  return phase === 'quiet' ? null : (
    <span className={workspaceStyles['navigation-dot']} />
  );
}

export function SpaceChip({ children }: { children: ReactNode }) {
  return (
    <span data-ui="space-chip" className={workspaceStyles['space-chip']}>
      {children}
    </span>
  );
}

export function WorkspacePrivacy() {
  return (
    <p
      data-ui="workspace-privacy"
      className={workspaceStyles['workspace-privacy']}
    >
      <AppIcon name="lock" />
      Only visible to authorized members
    </p>
  );
}
