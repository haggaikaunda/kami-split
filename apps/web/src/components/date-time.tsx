import { timestamp } from '@/lib/dates';

/** Readable UTC instant, with the original precision available to assistive tech. */
export function Timestamp({ value }: { value: string }) {
  return (
    <time
      dateTime={value}
      title={value}
      aria-label={`${timestamp(value)}; exact timestamp ${value}`}
    >
      {timestamp(value)}
    </time>
  );
}

/** Keyboard- and touch-accessible exact timestamp for audit/expiry inspection. */
export function ExactTimestamp({ value }: { value: string }) {
  return (
    <details>
      <summary>Exact timestamp</summary>
      <time dateTime={value} style={{ overflowWrap: 'anywhere' }}>
        {value}
      </time>
    </details>
  );
}
