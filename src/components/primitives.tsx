'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
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
  pending?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button--${tone} ${className}`}
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
}: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy =
    [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
      {hint && (
        <p id={`${id}-hint`} className="ui-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="ui-error">
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
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <select
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
        <p id={`${id}-hint`} className="ui-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="ui-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The caller supplies exact domain-formatted text; this component never rounds money. */
export function Money({
  value,
  currency,
}: {
  value: string;
  currency: string;
}) {
  return (
    <span className="ui-money">
      {value} <span className="ui-currency">{currency}</span>
    </span>
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
    <span className="ui-member">
      <span className="ui-avatar" aria-hidden="true">
        {photo ? (
          <MemberPhoto key={photo} src={photo} initials={initials} />
        ) : (
          initials
        )}
      </span>
      <span>
        <strong>{name}</strong>
        {detail && <span className="ui-member-detail">{detail}</span>}
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
      className={`ui-card${balance ? ' ui-card--balance' : ''}`}
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
      className={`ui-status ui-status--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <strong>{statusLabels[kind]}</strong>
      <div>{children}</div>
    </div>
  );
}
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="ui-toast" role="status" aria-live="polite">
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
    <div className="ui-status ui-status--error" role="alert">
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
export function Skeleton({ label = 'Loading expenses' }: { label?: string }) {
  return (
    <div role="status" className="ui-loading">
      <span>{label}…</span>
      <span aria-hidden="true" className="ui-skeleton" />
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
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
      className={`ui-dialog${panel ? ' ui-dialog--panel' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex]',
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
          heading.current?.focus();
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
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="ui-dialog-header">
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
      <div className="ui-actions">
        <button
          ref={safeAction}
          type="button"
          className="ui-button ui-button--secondary"
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

export type ChartRow = {
  id: string;
  label: string;
  value: string;
  count: number;
  magnitude: number;
};
/** Magnitude affects geometry only; the exact domain-formatted value is always visible. */
export function ChartTable({
  title,
  currency,
  rows,
  onSelect,
}: {
  title: string;
  currency: string;
  rows: readonly ChartRow[];
  onSelect?: (id: string) => void;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.magnitude));
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="ui-chart">
      <h3 id={titleId}>{title}</h3>
      <div className="ui-bars">
        {rows.map((row) => (
          <div key={row.id} className="ui-bar-row">
            <span>{row.label}</span>
            <span className="ui-bar-track" aria-hidden="true">
              <span
                style={{
                  width: `${maximum > 0 ? (Math.max(0, row.magnitude) / maximum) * 100 : 0}%`,
                }}
              />
            </span>
            {onSelect ? (
              <Button
                tone="secondary"
                onClick={() => onSelect(row.id)}
                aria-label={`${row.label}: ${row.value} ${currency}, ${row.count} expenses`}
              >
                <Money value={row.value} currency={currency} />
              </Button>
            ) : (
              <Money value={row.value} currency={currency} />
            )}
          </div>
        ))}
      </div>
      <div
        className="ui-table-scroll"
        role="region"
        aria-label={`${title} exact values`}
        tabIndex={0}
      >
        <table>
          <caption>{title}: exact values</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Amount ({currency})</th>
              <th scope="col">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>
                  <Money value={row.value} currency={currency} />
                </td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
