'use client';

import { useState } from 'react';
import {
  categories,
  selectSplit,
  editPercentage,
  remainingPercentage,
  validate,
  type Draft,
  type Member,
} from '@/lib/relay/draft';
import { Member as MemberLabel } from '../ui/primitives';
import { money } from '@/lib/relay/money';
import { cx } from '../ui/classnames';

import uiStyles from '../ui/primitives.module.css';
import workspaceStyles from '../workspace/patterns.module.css';
import formsFeatureStyles from './forms.module.css';

/** Shared exact-money and split controls for creation and versioned editing. */
export function ExpenseFields({
  draft,
  members,
  change,
  submitted,
}: {
  draft: Draft;
  members: readonly Member[];
  change: (patch: Partial<Draft>) => void;
  submitted: boolean;
}) {
  const checked = validate(draft, members);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const showNotes =
    notesExpanded || !!draft.note || (submitted && !!checked.errors.note);
  const field = (key: string) => ({
    'aria-invalid':
      (submitted || draft.split === 'PERCENTAGE') && !!checked.errors[key],
    'aria-describedby':
      (submitted || draft.split === 'PERCENTAGE') && checked.errors[key]
        ? `expense-${key}-error`
        : undefined,
  });
  return (
    <>
      <legend>Expense details</legend>
      <div
        data-ui="expense-fields-grid"
        className={formsFeatureStyles['expense-fields-grid']}
      >
        <div
          data-ui="expense-field expense-field--full"
          className={cx(
            formsFeatureStyles['expense-field'],
            formsFeatureStyles['expense-field--full'],
          )}
        >
          {' '}
          <label htmlFor="expense-description" data-ui="form-label">
            <span>Description</span>
          </label>
          <input
            id="expense-description"
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
            {...field('description')}
            data-ui="form-control"
          />
        </div>
        <div
          data-ui="expense-field"
          className={formsFeatureStyles['expense-field']}
        >
          {' '}
          <label htmlFor="expense-amount" data-ui="form-label">
            <span>Amount (USD)</span>
          </label>
          <input
            id="expense-amount"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => change({ amount: e.target.value })}
            {...field('amount')}
            data-ui="form-control"
          />
        </div>
        <div
          data-ui="expense-field"
          className={formsFeatureStyles['expense-field']}
        >
          {' '}
          <label htmlFor="expense-date" data-ui="form-label">
            <span>Date</span>
          </label>
          <input
            id="expense-date"
            type="date"
            value={draft.date}
            onChange={(e) => change({ date: e.target.value })}
            {...field('date')}
            data-ui="form-control"
          />
        </div>
        <div
          data-ui="expense-field"
          className={formsFeatureStyles['expense-field']}
        >
          {' '}
          <label htmlFor="expense-category" data-ui="form-label">
            <span>Category</span>
          </label>
          <select
            id="expense-category"
            value={draft.category}
            onChange={(e) =>
              change({ category: e.target.value as Draft['category'] })
            }
            {...field('category')}
            data-ui="form-control"
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category[0] + category.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div
          data-ui="expense-field"
          className={formsFeatureStyles['expense-field']}
        >
          {' '}
          <label htmlFor="expense-payer" data-ui="form-label">
            <span>Paid by</span>
          </label>
          <select
            id="expense-payer"
            value={draft.payer}
            onChange={(e) => change({ payer: e.target.value })}
            {...field('payer')}
            data-ui="form-control"
          >
            <option value="">Select payer</option>
            {members
              .filter((m) => m.canParticipate)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </div>
        <div
          data-ui="expense-field expense-field--full"
          className={cx(
            formsFeatureStyles['expense-field'],
            formsFeatureStyles['expense-field--full'],
          )}
        >
          {' '}
          <button
            type="button"
            aria-expanded={showNotes}
            aria-controls="expense-notes"
            onClick={() => setNotesExpanded(!notesExpanded)}
            hidden={!!draft.note || (submitted && !!checked.errors.note)}
            data-ui="form-button"
          >
            {notesExpanded ? 'Hide optional note' : 'Add optional note'}
          </button>
          <div
            className={formsFeatureStyles['expense-notes']}
            id="expense-notes"
            hidden={!showNotes}
          >
            <label htmlFor="expense-note" data-ui="form-label">
              <span>Note</span>
            </label>
            <textarea
              id="expense-note"
              value={draft.note}
              onChange={(e) => change({ note: e.target.value })}
              {...field('note')}
              data-ui="form-control"
            />
          </div>
        </div>
      </div>
      {draft.split === 'PERCENTAGE' && (
        <>
          <p
            id="percentage-rounding"
            data-ui="percentage-help"
            className={formsFeatureStyles['percentage-help']}
          >
            Percentages describe responsibility, not payment. Fractional cents
            go to the largest remainder, then ascending participant identity.
          </p>
          {draft.participants.length === 2 && (
            <label
              data-ui="percentage-link form-label"
              className={formsFeatureStyles['percentage-link']}
            >
              <input
                type="checkbox"
                checked={!!draft.linkedPercentages}
                onChange={(e) =>
                  change({ linkedPercentages: e.target.checked })
                }
                data-ui="form-checkbox"
              />
              Link percentages (two people)
            </label>
          )}
        </>
      )}
      <fieldset
        data-ui="financial-participants form-fieldset"
        className={formsFeatureStyles['financial-participants']}
        data-split={draft.split}
        {...field('participants')}
        tabIndex={-1}
      >
        <legend
          data-ui="visually-hidden"
          className={uiStyles['visually-hidden']}
        >
          Participants and preview
        </legend>
        <div
          data-ui="expense-split-heading"
          className={formsFeatureStyles['expense-split-heading']}
        >
          <label htmlFor="expense-split" data-ui="form-label">
            Split type
          </label>{' '}
          <select
            id="expense-split"
            value={draft.split}
            onChange={(e) =>
              change(selectSplit(draft, e.target.value as Draft['split']))
            }
            data-ui="form-control"
          >
            <option value="EQUAL">Equal</option>
            <option value="EXACT">Exact</option>
            <option value="PERCENTAGE">Percentage</option>
          </select>
          <span data-ui="space-chip" className={workspaceStyles['space-chip']}>
            {draft.participants.length} members
          </span>
        </div>
        <div
          data-ui="financial-participant-grid"
          className={formsFeatureStyles['financial-participant-grid']}
        >
          {members
            .filter((m) => m.canParticipate)
            .map((member) => (
              <div
                key={member.id}
                data-ui="financial-participant"
                className={formsFeatureStyles['financial-participant']}
              >
                <label data-ui="form-label">
                  <input
                    type="checkbox"
                    checked={draft.participants.includes(member.id)}
                    onChange={(e) =>
                      change({
                        linkedPercentages: false,
                        participants: e.target.checked
                          ? [...draft.participants, member.id]
                          : draft.participants.filter((id) => id !== member.id),
                      })
                    }
                    data-ui="form-checkbox"
                  />
                  <MemberLabel name={member.displayName} />
                </label>
                {draft.split === 'PERCENTAGE' &&
                draft.participants.includes(member.id) ? (
                  <div
                    data-ui="percentage-share"
                    className={formsFeatureStyles['percentage-share']}
                  >
                    <label
                      htmlFor={`percentage-${member.id}`}
                      data-ui="form-label"
                    >
                      Percentage for {member.displayName}
                    </label>
                    <div
                      data-ui="percentage-value"
                      className={formsFeatureStyles['percentage-value']}
                    >
                      <span
                        data-ui="percentage-input"
                        className={formsFeatureStyles['percentage-input']}
                      >
                        <input
                          id={`percentage-${member.id}`}
                          inputMode="decimal"
                          value={draft.percentages?.[member.id] ?? ''}
                          onChange={(e) =>
                            change({
                              percentages: editPercentage(
                                draft,
                                member.id,
                                e.target.value,
                              ),
                            })
                          }
                          aria-invalid={
                            !!checked.errors[`percentage-${member.id}`]
                          }
                          aria-describedby={
                            checked.errors[`percentage-${member.id}`]
                              ? `expense-percentage-${member.id}-error`
                              : 'percentage-rounding'
                          }
                          data-ui="form-control"
                        />
                        <span aria-hidden="true">%</span>
                      </span>
                      {Object.keys(checked.errors).length === 0 && (
                        <strong
                          data-ui="percentage-money"
                          className={formsFeatureStyles['percentage-money']}
                        >
                          {money(
                            checked.allocations.find(
                              (a) => a.participantId === member.id,
                            )!.amountMinor,
                          )}
                        </strong>
                      )}
                    </div>
                    {draft.participants.length >= 3 && (
                      <button
                        type="button"
                        disabled={
                          remainingPercentage(draft, member.id) === undefined
                        }
                        onClick={() =>
                          change({
                            percentages: {
                              ...draft.percentages,
                              [member.id]: remainingPercentage(
                                draft,
                                member.id,
                              )!,
                            },
                          })
                        }
                        data-ui="form-button"
                      >
                        Assign remaining to {member.displayName}
                      </button>
                    )}
                    {checked.errors[`percentage-${member.id}`] && (
                      <p
                        data-ui="financial-error"
                        className={formsFeatureStyles['financial-error']}
                        id={`expense-percentage-${member.id}-error`}
                      >
                        {checked.errors[`percentage-${member.id}`]}
                      </p>
                    )}
                  </div>
                ) : draft.split === 'EXACT' &&
                  draft.participants.includes(member.id) ? (
                  <label data-ui="form-label">
                    Exact USD for {member.displayName}
                    <input
                      inputMode="decimal"
                      value={draft.exact[member.id] ?? ''}
                      onChange={(e) =>
                        change({
                          exact: {
                            ...draft.exact,
                            [member.id]: e.target.value,
                          },
                        })
                      }
                      data-ui="form-control"
                    />
                  </label>
                ) : (
                  <span>
                    {checked.allocations.find(
                      (a) => a.participantId === member.id,
                    )
                      ? money(
                          checked.allocations.find(
                            (a) => a.participantId === member.id,
                          )!.amountMinor,
                        )
                      : 'Not included'}
                  </span>
                )}
              </div>
            ))}
        </div>
      </fieldset>
      {draft.split === 'PERCENTAGE' && (
        <p
          role="status"
          data-ui={`percentage-status ${checked.errors.participants ? 'percentage-incomplete' : ''}`}
          className={cx(
            formsFeatureStyles['percentage-status'],
            checked.errors.participants
              ? formsFeatureStyles['percentage-incomplete']
              : '',
          )}
        >
          {checked.errors.participants ??
            (Object.keys(checked.errors).some((key) =>
              key.startsWith('percentage-'),
            )
              ? 'Enter all selected percentages.'
              : '✓ 100% allocated')}
          {Object.keys(checked.errors).length === 0 &&
            ` · ${money(checked.total)} will be split as shown`}
        </p>
      )}
      {(submitted || draft.split === 'PERCENTAGE') &&
        Object.entries(checked.errors)
          .filter(([key]) => !key.startsWith('percentage-'))
          .map(([key, error]) => (
            <p
              data-ui="financial-error"
              className={formsFeatureStyles['financial-error']}
              id={`expense-${key}-error`}
              key={key}
            >
              {error}
            </p>
          ))}
    </>
  );
}
