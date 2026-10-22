'use client';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { WorkspaceNavigation } from '../workspace-identity';
import { WorkspaceHeader, NavigationPending } from '../workspace/patterns';
import { ExpenseEntryProvider } from '../expenses/entry';
import { useFinancialSession } from '../groups/session';
import { personalSection, personalSections } from './personal';
import shellStyles from '../workspace/shell.module.css';
import patternStyles from '../workspace/patterns.module.css';
import formStyles from '../ui/form-layout.module.css';
import { cx } from '../ui/classnames';
export function PersonalFrame({ children }: { children: ReactNode }) {
  const access = useFinancialSession();
  const pathname = usePathname(),
    params = useSearchParams();
  const current = personalSection(params.get('tab'));
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  return (
    <ExpenseEntryProvider scope={access.scope} visit={`${pathname}:${current}`}>
      <main
        id="page-content"
        className={cx(shellStyles.shell, formStyles['form-scope'])}
        data-ui="form-scope personal-workspace"
      >
        <WorkspaceNavigation headerRef={setHeader} />
        <div
          className={shellStyles['workspace-content']}
          data-ui="workspace-content"
        >
          {header &&
            createPortal(
              <WorkspaceHeader title="Personal" appearance="personal" />,
              header,
            )}
          <nav
            className={patternStyles['workspace-tabs']}
            data-ui="workspace-tabs"
            aria-label="Personal workspace"
          >
            {personalSections.map((section) => {
              const next = new URLSearchParams(params);
              next.set('tab', section.toLowerCase());
              return (
                <Link
                  scroll={false}
                  key={section}
                  href={`/personal?${next}`}
                  aria-current={current === section ? 'page' : undefined}
                >
                  {section}
                  <NavigationPending />
                </Link>
              );
            })}
          </nav>
          {children}
        </div>
      </main>
    </ExpenseEntryProvider>
  );
}
