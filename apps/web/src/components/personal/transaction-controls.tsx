'use client';
import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Dialog, Field } from '../ui/primitives';
import {
  appliedPeriod,
  customDateError,
  periods,
  personalHref,
  readable,
  type Period,
} from './transaction-state';
import styles from './transactions.module.css';
type Account = { accountId: string; kind: string };
export function TransactionControls({
  start,
  end,
  today,
  timezone,
  accounts,
  names,
  activities,
  categories,
}: {
  start: string;
  end: string;
  today: string;
  timezone: string;
  accounts: readonly Account[];
  names: ReadonlyMap<string, string>;
  activities: readonly string[];
  categories: readonly string[];
}) {
  const params = useSearchParams(),
    router = useRouter();
  const [panel, setPanel] = useState<'dates' | 'filters' | null>(null);
  const dates = useRef<HTMLButtonElement>(null),
    filters = useRef<HTMLButtonElement>(null);
  const [period, setPeriod] = useState<Period>(appliedPeriod(params));
  const [from, setFrom] = useState(start),
    [to, setTo] = useState(end),
    [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const open = (kind: 'dates' | 'filters') => {
    setPeriod(appliedPeriod(params));
    setFrom(start);
    setTo(end);
    setError('');
    setDraft(
      Object.fromEntries(
        [
          'account',
          'activity',
          'category',
          'state',
          'reviewed',
          'excluded',
        ].map((key) => [key, params.get(key) ?? '']),
      ),
    );
    setPanel(kind);
  };
  const apply = () => {
    const message =
      panel === 'dates' && period === 'custom'
        ? customDateError(from, to, today)
        : '';
    if (message) {
      setError(message);
      return;
    }
    const changes =
      panel === 'dates'
        ? {
            period,
            start: period === 'custom' ? from : null,
            end: period === 'custom' ? to : null,
          }
        : draft;
    setPanel(null);
    router.push(
      personalHref(new URLSearchParams(params), {
        ...changes,
        transaction: null,
      }),
      { scroll: false },
    );
  };
  const active = [
    'account',
    'activity',
    'category',
    'state',
    'reviewed',
    'excluded',
  ].filter((key) => params.has(key));
  return (
    <>
      <div className={styles.toolbar}>
        <Button
          ref={dates}
          tone="secondary"
          aria-expanded={panel === 'dates'}
          aria-haspopup="dialog"
          aria-controls={panel ? `personal-${panel}-panel` : undefined}
          onClick={() => open('dates')}
        >
          {periods[appliedPeriod(params)]}
        </Button>
        <Button
          ref={filters}
          tone="secondary"
          aria-expanded={panel === 'filters'}
          aria-haspopup="dialog"
          aria-controls={panel ? `personal-${panel}-panel` : undefined}
          onClick={() => open('filters')}
        >
          Filters{active.length ? ` · ${active.length}` : ''}
        </Button>
      </div>
      <p className={styles.period}>
        {start || 'Dates unavailable'} – {end || 'Dates unavailable'} · USD{' '}
        <span>
          Posted bank dates · {timezone || 'Saved timezone unavailable'}
        </span>
      </p>
      {active.length > 0 && (
        <div className={styles.chips}>
          {active.map((key) => (
            <Button
              key={key}
              tone="text"
              onClick={() =>
                router.push(
                  personalHref(new URLSearchParams(params), {
                    [key]: null,
                    transaction: null,
                  }),
                  { scroll: false },
                )
              }
            >
              Clear {key}:{' '}
              {key === 'account'
                ? (names.get(params.get(key)!) ?? 'Retained account')
                : readable(params.get(key)!)}
            </Button>
          ))}
        </div>
      )}
      {panel && (
        <div className={styles.dialogHost} id={`personal-${panel}-panel`}>
          <Dialog
            open
            title={panel === 'dates' ? 'Date range' : 'Filter transactions'}
            onClose={() => setPanel(null)}
            returnFocusRef={panel === 'dates' ? dates : filters}
          >
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                apply();
              }}
            >
              {panel === 'dates' ? (
                <>
                  <p>
                    Applies to Overview and Transactions. Available history may
                    be partial.
                  </p>
                  <div className={styles.presets}>
                    {Object.entries(periods).map(([key, label]) => (
                      <Button
                        key={key}
                        tone="secondary"
                        aria-pressed={key === period}
                        onClick={() => setPeriod(key as Period)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {period === 'custom' && (
                    <>
                      <Field
                        type="date"
                        label="Start date"
                        error={error}
                        value={from}
                        max={today}
                        min="0001-01-01"
                        onChange={(event) => setFrom(event.target.value)}
                      />
                      <Field
                        type="date"
                        label="End date"
                        error={error}
                        value={to}
                        max={today}
                        min="0001-01-01"
                        onChange={(event) => setTo(event.target.value)}
                      />
                    </>
                  )}
                  {error && <p role="alert">{error}</p>}
                </>
              ) : (
                <div className={styles.fields}>
                  <label>
                    Accounts
                    <select
                      value={draft.account}
                      onChange={(e) =>
                        setDraft({ ...draft, account: e.target.value })
                      }
                    >
                      <option value="">All retained accounts</option>
                      {accounts.map((account) => (
                        <option
                          key={account.accountId}
                          value={account.accountId}
                        >
                          {names.get(account.accountId) ??
                            `Retained ${readable(account.kind)} account`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Activity type
                    <select
                      value={draft.activity}
                      onChange={(e) =>
                        setDraft({ ...draft, activity: e.target.value })
                      }
                    >
                      <option value="">All activity</option>
                      {activities.map((value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select
                      value={draft.category}
                      onChange={(e) =>
                        setDraft({ ...draft, category: e.target.value })
                      }
                    >
                      <option value="">All categories</option>
                      {categories.map((value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bank status
                    <select
                      value={draft.state}
                      onChange={(e) =>
                        setDraft({ ...draft, state: e.target.value })
                      }
                    >
                      <option value="">All statuses</option>
                      {['posted', 'pending', 'removed'].map((value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Review status
                    <select
                      value={draft.reviewed}
                      onChange={(e) =>
                        setDraft({ ...draft, reviewed: e.target.value })
                      }
                    >
                      <option value="">Any review status</option>
                      <option value="false">Needs review</option>
                      <option value="true">Reviewed</option>
                    </select>
                  </label>
                  <label>
                    Private exclusion
                    <select
                      value={draft.excluded}
                      onChange={(e) =>
                        setDraft({ ...draft, excluded: e.target.value })
                      }
                    >
                      <option value="">Included and excluded</option>
                      <option value="false">Included</option>
                      <option value="true">Excluded</option>
                    </select>
                  </label>
                  <Button
                    tone="text"
                    onClick={() =>
                      setDraft(
                        Object.fromEntries(
                          Object.keys(draft).map((key) => [key, '']),
                        ),
                      )
                    }
                  >
                    Reset filters
                  </Button>
                </div>
              )}
              <div className={styles.actions}>
                <Button tone="secondary" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Apply {panel === 'dates' ? 'dates' : 'filters'}
                </Button>
              </div>
            </form>
          </Dialog>
        </div>
      )}
    </>
  );
}
