'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button } from '../ui/primitives';
import { categories } from '@/lib/relay/draft';
import { datePreset, expenseFilterText } from '@/lib/relay/expense-filter';
import { overviewDate } from '@/components/groups/overview-date';
import type { LedgerSpace } from './ledger';
import { cx } from '../ui/classnames';

import uiStyles from '../ui/primitives.module.css';
import filterFeatureStyles from './filter-form.module.css';

function FilterSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details
      data-ui="ledger-filter-section"
      className={filterFeatureStyles['ledger-filter-section']}
    >
      <summary>
        <span>
          <span
            data-ui="ledger-filter-title"
            className={filterFeatureStyles['ledger-filter-title']}
          >
            {title}
          </span>
          <span
            data-ui="ledger-filter-summary"
            className={filterFeatureStyles['ledger-filter-summary']}
          >
            {summary}
          </span>
        </span>
        <span
          data-ui="ledger-filter-chevron"
          className={filterFeatureStyles['ledger-filter-chevron']}
          aria-hidden="true"
        />
      </summary>
      <div
        data-ui="ledger-filter-section-content"
        className={filterFeatureStyles['ledger-filter-section-content']}
      >
        {children}
      </div>
    </details>
  );
}

export function ExpenseFilterForm({
  filterText,
  groupId,
  layout,
  spaces,
  today,
  onApply,
}: {
  filterText: string;
  groupId: string;
  layout: 'group' | 'household';
  spaces: readonly LedgerSpace[];
  today: string;
  onApply: (data: FormData) => void;
}) {
  const [draft, setDraft] = useState(
    () =>
      new URLSearchParams(expenseFilterText(new URLSearchParams(filterText))),
  );
  const [preset, setPreset] = useState(
    draft.get('from') || draft.get('to') ? 'custom' : 'all',
  );
  const id = useId();
  const update = (key: string, value: string | string[]) => {
    setDraft((previous) => {
      const next = new URLSearchParams(previous);
      next.delete(key);
      for (const item of Array.isArray(value) ? value : [value])
        if (item) next.append(key, item);
      return next;
    });
  };
  const toggle = (key: string, value: string, checked: boolean) => {
    const selected = draft.getAll(key);
    update(
      key,
      checked ? [...selected, value] : selected.filter((v) => v !== value),
    );
  };
  const selectedCategories = draft.getAll('categories');
  const from = draft.get('from') ?? '';
  const to = draft.get('to') ?? '';
  const categoryLabel = (value: string) =>
    value[0] + value.slice(1).toLowerCase();
  const dateSummary =
    from && to
      ? `${overviewDate(from, false, true)} – ${overviewDate(to, false, true)}`
      : from
        ? `From ${overviewDate(from, false, true)}`
        : to
          ? `Until ${overviewDate(to, false, true)}`
          : 'All dates';

  return (
    <form
      data-ui="ledger-filters"
      data-scope={layout}
      className={filterFeatureStyles['ledger-filters']}
      onSubmit={(event) => {
        event.preventDefault();
        onApply(new FormData(event.currentTarget));
      }}
    >
      <div
        data-ui="ledger-filter-scroll"
        className={filterFeatureStyles['ledger-filter-scroll']}
      >
        {!groupId && (
          <label
            data-ui="ledger-filter-field form-label"
            className={filterFeatureStyles['ledger-filter-field']}
          >
            <span>Space</span>
            <select
              name="groupId"
              value={draft.get('groupId') ?? ''}
              onChange={(event) => update('groupId', event.target.value)}
              data-ui="form-control"
            >
              <option value="">All spaces</option>
              {spaces.map((space) => (
                <option key={space.groupId} value={space.groupId}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <FilterSection
          title="Categories"
          summary={
            selectedCategories.length === 1
              ? categoryLabel(selectedCategories[0])
              : selectedCategories.length
                ? `${selectedCategories.length} selected`
                : 'All categories'
          }
        >
          <fieldset
            data-ui={
              'ledger-filter-options ledger-filter-categories' +
              ' form-fieldset'
            }
            className={cx(
              filterFeatureStyles['ledger-filter-options'],
              filterFeatureStyles['ledger-filter-categories'],
            )}
          >
            <legend
              data-ui="visually-hidden"
              className={uiStyles['visually-hidden']}
            >
              Categories
            </legend>
            {categories.map((category) => (
              <label key={category} data-ui="form-label">
                <input
                  type="checkbox"
                  name="categories"
                  value={category}
                  checked={selectedCategories.includes(category)}
                  onChange={(event) =>
                    toggle('categories', category, event.target.checked)
                  }
                  data-ui="form-checkbox"
                />
                <span>{categoryLabel(category)}</span>
              </label>
            ))}
          </fieldset>
        </FilterSection>
        {(['paidByIds', 'memberIds'] as const).map((key) => {
          const selected = draft.getAll(key);
          const title = key === 'paidByIds' ? 'Paid by' : 'Involving';
          return (
            <FilterSection
              key={key}
              title={title}
              summary={
                selected.length ? `${selected.length} selected` : 'Anyone'
              }
            >
              {key === 'memberIds' && (
                <p
                  id={`${id}-involving`}
                  data-ui="ledger-filter-hint"
                  className={filterFeatureStyles['ledger-filter-hint']}
                >
                  Payer or participant, including zero shares.
                </p>
              )}
              {spaces.map((space) => (
                <fieldset
                  data-ui="ledger-filter-options form-fieldset"
                  className={filterFeatureStyles['ledger-filter-options']}
                  key={space.groupId}
                  aria-describedby={
                    key === 'memberIds' ? `${id}-involving` : undefined
                  }
                >
                  <legend>{space.name}</legend>
                  {space.members.map((member) => (
                    <label key={member.id} data-ui="form-label">
                      <input
                        type="checkbox"
                        name={key}
                        value={member.id}
                        checked={selected.includes(member.id)}
                        onChange={(event) =>
                          toggle(key, member.id, event.target.checked)
                        }
                        data-ui="form-checkbox"
                      />
                      <span>{member.displayName}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </FilterSection>
          );
        })}
        <FilterSection title="Dates" summary={dateSummary}>
          <label
            data-ui="ledger-filter-field form-label"
            className={filterFeatureStyles['ledger-filter-field']}
          >
            <span>Date range</span>
            <select
              value={preset}
              onChange={(event) => {
                const value = event.target.value;
                setPreset(value);
                if (value === 'custom') return;
                const range = datePreset(today, value);
                update('from', range.from);
                update('to', range.to);
              }}
              data-ui="form-control"
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="month">This month to date</option>
              <option value="previousMonth">Previous month</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <div
            data-ui="ledger-filter-date-fields"
            className={filterFeatureStyles['ledger-filter-date-fields']}
          >
            {(['from', 'to'] as const).map((key) => (
              <label
                data-ui="ledger-filter-field form-label"
                className={filterFeatureStyles['ledger-filter-field']}
                key={key}
              >
                <span>{key === 'from' ? 'From' : 'To'}</span>
                <input
                  name={key}
                  type="date"
                  value={draft.get(key) ?? ''}
                  aria-describedby={`${id}-dates`}
                  onChange={(event) => {
                    setPreset('custom');
                    update(key, event.target.value);
                  }}
                  data-ui="form-control"
                />
              </label>
            ))}
          </div>
          <p
            id={`${id}-dates`}
            data-ui="ledger-filter-hint"
            className={filterFeatureStyles['ledger-filter-hint']}
          >
            Includes both dates.
          </p>
        </FilterSection>
        <label
          data-ui="ledger-filter-field ledger-filter-sort form-label"
          className={cx(
            filterFeatureStyles['ledger-filter-field'],
            filterFeatureStyles['ledger-filter-sort'],
          )}
        >
          <span>Sort</span>
          <select
            name="sort"
            value={draft.get('sort') || 'DATE_DESC'}
            onChange={(event) => update('sort', event.target.value)}
            data-ui="form-control"
          >
            <option value="DATE_DESC">Date: newest first</option>
            <option value="DATE_ASC">Date: oldest first</option>
            <option value="AMOUNT_DESC">Amount: highest first</option>
            <option value="AMOUNT_ASC">Amount: lowest first</option>
          </select>
        </label>
      </div>
      <div
        data-ui="ledger-filter-actions"
        className={filterFeatureStyles['ledger-filter-actions']}
      >
        <Button
          tone="text"
          type="button"
          aria-label="Reset filters"
          onClick={() => {
            setDraft(new URLSearchParams());
            setPreset('all');
          }}
        >
          Reset
        </Button>
        <Button type="submit" aria-label="Apply filters">
          Apply filters
        </Button>
      </div>
    </form>
  );
}
