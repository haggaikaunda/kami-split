'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import type { CommandState } from './session-command';
import { Status } from './primitives';

function RecoveryAction({
  children,
  onRecover,
}: {
  children: ReactNode;
  onRecover: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    // Wait for the parent dialog's opening effect. Never pull focus back after
    // the route unmounts, or into a retained but closed background dialog.
    queueMicrotask(() => {
      const target = button.current;
      if (
        !active ||
        !target?.isConnected ||
        target.closest('[inert], [hidden]')
      )
        return;
      const dialog = target.closest('dialog');
      if (!dialog || dialog.open) target.focus();
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <button
      ref={button}
      className="ui-button ui-button--primary"
      type="button"
      onClick={onRecover}
    >
      {children}
    </button>
  );
}
export function CommandFeedback({
  state,
  onRecover,
  recoveryLabel,
}: {
  state?: CommandState;
  onRecover?: () => void;
  recoveryLabel: string;
}) {
  if (!state || state.phase === 'saved') return null;
  return (
    <Status kind={state.phase === 'failed' ? 'error' : 'pending'}>
      {state.message}
      {state.phase === 'unknown' && onRecover && (
        <div className="ui-actions">
          <RecoveryAction onRecover={onRecover}>{recoveryLabel}</RecoveryAction>
        </div>
      )}
    </Status>
  );
}
