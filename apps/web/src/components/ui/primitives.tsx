'use client';
import uiStyles from './primitives.module.css';
import { cx } from './classnames';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type Ref,
  type SelectHTMLAttributes,
} from 'react';

export function Button({
  children,
  pending = false,
  tone = 'primary',
  className = '',
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  pending?: boolean;
  tone?: 'primary' | 'secondary' | 'tonal' | 'text' | 'danger';
}) {
  return (
    <button
      {...props}
      type={type}
      data-ui={`button button--${tone}`}
      className={cx(uiStyles['button'], uiStyles[`button--${tone}`], className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

type FieldProps = { label: string; hint?: string; error?: string };

export function Field({
  label,
  hint,
  error,
  id: suppliedId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> &
  FieldProps & { ref?: Ref<HTMLInputElement> }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy =
    [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div data-ui="field" className={uiStyles['field']}>
      <label data-ui="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        data-ui="field-control"
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
      {hint && (
        <p id={`${id}-hint`} data-ui="hint" className={uiStyles['hint']}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} data-ui="error" className={uiStyles['error']}>
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id: suppliedId,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <div data-ui="field" className={uiStyles['field']}>
      <label data-ui="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        data-ui="field-control"
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [
            props['aria-describedby'],
            hint && `${id}-hint`,
            error && `${id}-error`,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        {children}
      </select>
      {hint && (
        <p id={`${id}-hint`} data-ui="hint" className={uiStyles['hint']}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} data-ui="error" className={uiStyles['error']}>
          {error}
        </p>
      )}
    </div>
  );
}

function MemberPhoto({ src, initials }: { src: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    initials
  ) : (
    // Native image keeps this shared primitive independent of a Next image service.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={44}
      height={44}
      onError={() => setFailed(true)}
    />
  );
}

export function Member({
  name,
  photo,
  detail,
}: {
  name: string;
  photo?: string;
  detail?: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => Array.from(part)[0])
      .slice(0, 2)
      .join('') || '?';
  return (
    <span data-ui="member" className={uiStyles['member']} title={name}>
      <span data-ui="avatar" className={uiStyles['avatar']} aria-hidden="true">
        {photo ? (
          <MemberPhoto key={photo} src={photo} initials={initials} />
        ) : (
          initials
        )}
      </span>
      <span data-ui="member-copy">
        <strong data-ui="member-name">{name}</strong>
        {detail && (
          <span data-ui="member-detail" className={uiStyles['member-detail']}>
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}

export function Card({
  title,
  children,
  balance = false,
}: {
  title: string;
  children: ReactNode;
  balance?: boolean;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-ui={`card${balance ? ' card--balance' : ''}`}
      className={cx(uiStyles['card'], balance && uiStyles['card--balance'])}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}

export type StatusKind =
  'info' | 'pending' | 'error' | 'success' | 'stale' | 'denied';

const statusLabels: Record<StatusKind, string> = {
  info: 'Information',
  pending: 'In progress',
  error: 'Could not complete',
  success: 'Complete',
  stale: 'Updates available',
  denied: 'Unavailable',
};

export function Status({
  kind = 'info',
  children,
}: {
  kind?: StatusKind;
  children: ReactNode;
}) {
  return (
    <div
      data-ui={`status status--${kind}`}
      className={cx(uiStyles['status'], uiStyles[`status--${kind}`])}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <strong>{statusLabels[kind]}</strong>
      <div>{children}</div>
    </div>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="toast"
      className={uiStyles['toast']}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function ErrorSummary({
  errors,
}: {
  errors: readonly { fieldId: string; message: string }[];
}) {
  const firstFieldId = errors[0]?.fieldId;
  useEffect(() => {
    if (firstFieldId) document.getElementById(firstFieldId)?.focus();
  }, [firstFieldId]);
  if (!errors.length) return null;
  return (
    <div
      data-ui="status status--error"
      className={cx(uiStyles['status'], uiStyles['status--error'])}
      role="alert"
    >
      <strong>Check these fields</strong>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.fieldId)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Skeleton({
  label = 'Loading expenses',
  size = 'default',
}: {
  label?: string;
  size?: 'default' | 'workspace';
}) {
  return (
    <div
      role="status"
      data-ui="loading"
      className={cx(
        uiStyles.loading,
        size === 'workspace' && uiStyles['loading--workspace'],
      )}
    >
      <span>{label}…</span>
      <span
        aria-hidden="true"
        data-ui="skeleton"
        className={uiStyles['skeleton']}
      />
      <span
        aria-hidden="true"
        data-ui="skeleton"
        className={uiStyles['skeleton']}
      />
      <span
        aria-hidden="true"
        data-ui="skeleton"
        className={uiStyles['skeleton']}
      />
    </div>
  );
}

export function EmptyState({
  headingLevel = 3,
  title,
  children,
  action,
}: {
  headingLevel?: 2 | 3;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div data-ui="empty" className={uiStyles['empty']}>
      {headingLevel === 2 ? <h2>{title}</h2> : <h3>{title}</h3>}
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Wrap visible enabled controls inside a native modal, including reverse Tab. */
export function containDialogFocus(
  event: KeyboardEvent<HTMLDialogElement>,
  fallback: HTMLElement | null,
) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, summary, a[href], [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.getClientRects().length > 0,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    fallback?.focus();
  } else if (
    event.shiftKey &&
    (!controls.includes(document.activeElement as HTMLElement) ||
      document.activeElement === first)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

type DialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  panel?: boolean;
};

/** Native modal dialogs provide inert background, Escape, and keyboard focus containment. */
export function Dialog({
  open,
  title,
  children,
  onClose,
  initialFocusRef,
  returnFocusRef,
  panel = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    const returnTarget = returnFocusRef?.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    (initialFocusRef?.current ?? heading.current)?.focus();
    return () => {
      dialog.close();
      const target = returnTarget ?? (trigger?.isConnected ? trigger : null);
      if (target?.isConnected) target.focus();
      else {
        // If the trigger was removed by a mutation, return to the surviving page.
        const fallback =
          document.querySelector<HTMLElement>('main') ?? document.body;
        const previous = fallback.getAttribute('tabindex');
        fallback.setAttribute('tabindex', '-1');
        fallback.focus();
        if (previous === null) fallback.removeAttribute('tabindex');
        else fallback.setAttribute('tabindex', previous);
      }
    };
  }, [open, initialFocusRef, returnFocusRef]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-ui={`dialog${panel ? ' dialog--panel' : ''}`}
      className={cx(uiStyles['dialog'], panel && uiStyles['dialog--panel'])}
      onKeyDown={(event) => containDialogFocus(event, heading.current)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header data-ui="dialog-header" className={uiStyles['dialog-header']}>
        <h2 ref={heading} tabIndex={-1} id={titleId}>
          {title}
        </h2>
        <Button
          tone="secondary"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          Close
        </Button>
      </header>
      {children}
    </dialog>
  );
}

export function Confirmation({
  open,
  title,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const safeAction = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      initialFocusRef={safeAction}
    >
      <div>{children}</div>
      <div data-ui="actions" className={uiStyles['actions']}>
        <button
          ref={safeAction}
          type="button"
          data-ui="button button--secondary"
          className={cx(uiStyles['button'], uiStyles['button--secondary'])}
          onClick={onCancel}
        >
          Keep editing
        </button>
        <Button tone="danger" pending={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
