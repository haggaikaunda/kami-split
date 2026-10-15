'use client';
import workspaceStyles from './patterns.module.css';
import { cx } from '../ui/classnames';

import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { AppIcon } from '../workspace-identity';

/** Context belongs in the header; financial data stays on a plain surface. */
export function WorkspaceHeader({
  title,
  context,
  children,
  appearance,
  compact = false,
}: {
  title: string;
  context?: ReactNode;
  children?: ReactNode;
  appearance?: 'household' | 'trip' | 'group';
  compact?: boolean;
}) {
  return (
    <header
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
  onIntent,
  onIntentEnd,
}: {
  current: WorkspaceSection;
  hrefFor: (section: WorkspaceSection) => string;
  label?: string;
  onIntent?: (section: WorkspaceSection) => void;
  onIntentEnd?: (section?: WorkspaceSection) => void;
}) {
  return (
    <nav
      data-ui="workspace-tabs"
      className={workspaceStyles['workspace-tabs']}
      aria-label={label}
    >
      {workspaceSections.map((section) => (
        <Link
          scroll={false}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch' && current !== section)
              onIntent?.(section);
          }}
          onFocus={() => {
            if (current !== section) onIntent?.(section);
          }}
          onPointerLeave={() => onIntentEnd?.(section)}
          onBlur={() => onIntentEnd?.(section)}
          onNavigate={() => onIntentEnd?.()}
          key={section}
          href={hrefFor(section)}
          aria-current={current === section ? 'page' : undefined}
        >
          {section}
          <NavigationPending />
        </Link>
      ))}
    </nav>
  );
}

function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      data-ui="workspace-navigation-pending"
      className={workspaceStyles['workspace-navigation-pending']}
      role="status"
    >
      Opening…
    </span>
  ) : null;
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
