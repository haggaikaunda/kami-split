'use client';
import { useEffect, useState } from 'react';
import { SkeletonBlock } from './primitives';
import { cx } from './classnames';
import styles from './loading.module.css';

/** Presentation time only: callers remove private content before mounting and
 * unmount as soon as data, an error, or an access decision is available. */
export function useLoadingPhase() {
  const [phase, setPhase] = useState<'quiet' | 'loading' | 'slow'>('quiet');
  useEffect(() => {
    const show = setTimeout(() => setPhase('loading'), 150);
    const slow = setTimeout(() => setPhase('slow'), 8_000);
    return () => {
      clearTimeout(show);
      clearTimeout(slow);
    };
  }, []);
  return phase;
}

export function LoadingDots({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.dots, compact && styles.compact)}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

/** Public startup presentation; never accepts account or workspace data. */
export function ScreenLoading() {
  const phase = useLoadingPhase();
  return (
    <main className={styles.screen} data-ui="screen-loading">
      <header className={styles.brand}>Kami Grow</header>
      <div className={styles.center}>
        <div className={styles.message}>
          {phase !== 'quiet' && <LoadingDots />}
          <div role="status" aria-live="polite" aria-atomic="true">
            {phase !== 'quiet' && (
              <>
                <h1>
                  {phase === 'slow'
                    ? 'Still getting things ready'
                    : 'Getting things ready'}
                </h1>
                <p>
                  {phase === 'slow'
                    ? 'This is taking a little longer.'
                    : 'Opening your account…'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      <div role="region" aria-busy="true" aria-label="Account content" />
    </main>
  );
}

export type LoadingLayout =
  'overview' | 'expenses' | 'balances' | 'activity' | 'members' | 'cards';

/** One status outside the busy region so assistive technology can announce it.
 * Shapes are generic geometry, never values or records from an earlier read. */
export function ContentLoading({
  layout,
  label = layout,
}: {
  layout: LoadingLayout;
  label?: string;
}) {
  const phase = useLoadingPhase();
  return (
    <div
      data-ui="content-loading"
      data-layout={layout}
      className={styles.content}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.status}
      >
        {phase !== 'quiet' && (
          <>
            <LoadingDots compact />
            <span>
              {phase === 'slow' ? 'Still loading' : 'Loading'} {label}…
            </span>
          </>
        )}
      </div>
      <div role="region" aria-busy="true" aria-label={`${label} content`}>
        {phase !== 'quiet' && <LoadingShapes layout={layout} />}
      </div>
    </div>
  );
}

function LoadingShapes({ layout }: { layout: LoadingLayout }) {
  const summary =
    layout === 'overview' || layout === 'balances' || layout === 'cards';
  return (
    <div aria-hidden="true" className={cx(styles.shapes, styles[layout])}>
      {summary && (
        <div className={styles.metrics}>
          {Array.from({ length: layout === 'overview' ? 3 : 2 }, (_, index) => (
            <div className={styles.card} key={index}>
              <SkeletonBlock className={styles.short} />
              <SkeletonBlock className={styles.value} />
              <SkeletonBlock className={styles.line} />
            </div>
          ))}
        </div>
      )}
      {layout !== 'cards' && (
        <div className={styles.list}>
          {layout === 'expenses' ? (
            <div className={styles.month}>
              <div className={styles.copy}>
                <SkeletonBlock className={styles.short} />
                <SkeletonBlock className={styles.detail} />
              </div>
              <SkeletonBlock className={styles.amount} />
            </div>
          ) : (
            <SkeletonBlock className={styles.short} />
          )}
          {Array.from({ length: layout === 'overview' ? 4 : 3 }, (_, index) => (
            <div className={styles.row} key={index}>
              <SkeletonBlock className={styles.avatar} />
              <div className={styles.copy}>
                <SkeletonBlock className={styles.line} />
                <SkeletonBlock className={styles.detail} />
              </div>
              {layout !== 'activity' && (
                <SkeletonBlock className={styles.amount} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
