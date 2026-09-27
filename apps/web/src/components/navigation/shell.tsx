'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Confirmation } from '../primitives';
import { useExpenseNavigation } from './provider';
const destinations = [
  { href: '/', label: 'Overview' },
  { href: '/history', label: 'History' },
  { href: '/trips', label: 'Trips' },
  { href: '/household', label: 'Household' },
];

export function NavigationShell({
  children,
  detail,
}: {
  children: ReactNode;
  detail: ReactNode;
}) {
  const pathname = usePathname();
  const { drafts, discardDraft, resumeDraft, announcement } =
    useExpenseNavigation();
  const [discardId, setDiscardId] = useState<string | null>(null);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href={
          pathname.startsWith('/expenses/')
            ? '#expense-heading'
            : '#page-content'
        }
      >
        Skip to content
      </a>
      <header className="shell-brand">
        <Link href="/">Kami Split</Link>
        <Link href="/sign-in">Account preview</Link>
      </header>
      <nav className="shell-nav" aria-label="Main navigation">
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={
              (
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href)
              )
                ? 'page'
                : undefined
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="shell-workspace">
        <div className="draft-banners">
          {Object.values(drafts).map((draft) => (
            <section
              key={draft.id}
              className="draft-banner"
              aria-label={`Preserved ${draft.label}`}
            >
              <p>
                {draft.pending
                  ? 'Request in progress. Your draft and operation are retained.'
                  : 'Unsaved draft preserved for this session.'}
              </p>
              <Link
                href={draft.href}
                onClick={(event) => {
                  if (
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey &&
                    event.button === 0
                  ) {
                    event.preventDefault();
                    resumeDraft(draft.id);
                  }
                }}
              >
                Resume {draft.label}
              </Link>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled={draft.pending}
                onClick={() => setDiscardId(draft.id)}
              >
                Discard draft
              </button>
            </section>
          ))}
        </div>
        <div className="shell-content">
          <main id="page-content" tabIndex={-1}>
            {children}
          </main>
          <div className="detail-slot">{detail}</div>
        </div>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <Confirmation
        open={discardId !== null}
        title="Discard this unsaved draft?"
        confirmLabel="Discard draft"
        onCancel={() => setDiscardId(null)}
        onConfirm={() => {
          if (discardId) discardDraft(discardId);
          setDiscardId(null);
        }}
      >
        This discards the session draft. Existing financial records are
        unchanged.
      </Confirmation>
    </div>
  );
}
