'use client';
import {
  categories,
  selectSplit,
  editPercentage,
  remainingPercentage,
  validate,
  type Draft,
  type Member,
} from '@/lib/relay/draft';
import { Member as MemberLabel } from '@/components/primitives';
import { money } from '@/lib/relay/money';
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
      <label htmlFor="expense-description">Description</label>
      <input
        id="expense-description"
        value={draft.description}
        onChange={(e) => change({ description: e.target.value })}
        {...field('description')}
      />
      <label htmlFor="expense-amount">Amount (USD)</label>
      <input
        id="expense-amount"
        inputMode="decimal"
        value={draft.amount}
        onChange={(e) => change({ amount: e.target.value })}
        {...field('amount')}
      />
      <label htmlFor="expense-date">Date</label>
      <input
        id="expense-date"
        type="date"
        value={draft.date}
        onChange={(e) => change({ date: e.target.value })}
        {...field('date')}
      />
      <label htmlFor="expense-category">Category</label>
      <select
        id="expense-category"
        value={draft.category}
        onChange={(e) =>
          change({ category: e.target.value as Draft['category'] })
        }
        {...field('category')}
      >
        {categories.map((category) => (
          <option key={category} value={category}>
            {category[0] + category.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      <label htmlFor="expense-note">Note</label>
      <textarea
        id="expense-note"
        value={draft.note}
        onChange={(e) => change({ note: e.target.value })}
        {...field('note')}
      />
      <label htmlFor="expense-payer">Paid by</label>
      <select
        id="expense-payer"
        value={draft.payer}
        onChange={(e) => change({ payer: e.target.value })}
        {...field('payer')}
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
      <label htmlFor="expense-split">Split type</label>
      <select
        id="expense-split"
        value={draft.split}
        onChange={(e) =>
          change(selectSplit(draft, e.target.value as Draft['split']))
        }
      >
        <option value="EQUAL">Equal</option>
        <option value="EXACT">Exact</option>
        <option value="PERCENTAGE">Percentage</option>
      </select>
      {draft.split === 'PERCENTAGE' && (
        <>
          <p id="percentage-rounding" className="percentage-help">
            Percentages describe responsibility, not payment. Fractional cents
            go to the largest remainder, then ascending participant identity.
          </p>
          {draft.participants.length === 2 && (
            <label className="percentage-link">
              <input
                type="checkbox"
                checked={!!draft.linkedPercentages}
                onChange={(e) =>
                  change({ linkedPercentages: e.target.checked })
                }
              />
              Link percentages (two people)
            </label>
          )}
        </>
      )}
      <fieldset {...field('participants')} tabIndex={-1}>
        <legend>Participants and preview</legend>
        {members
          .filter((m) => m.canParticipate)
          .map((member) => (
            <div key={member.id} className="financial-participant">
              <label>
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
                />
                <MemberLabel name={member.displayName} />
              </label>
              {draft.split === 'PERCENTAGE' &&
              draft.participants.includes(member.id) ? (
                <div className="percentage-share">
                  <label htmlFor={`percentage-${member.id}`}>
                    Percentage for {member.displayName}
                  </label>
                  <div className="percentage-value">
                    <span className="percentage-input">
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
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                    {Object.keys(checked.errors).length === 0 && (
                      <strong className="percentage-money">
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
                            [member.id]: remainingPercentage(draft, member.id)!,
                          },
                        })
                      }
                    >
                      Assign remaining to {member.displayName}
                    </button>
                  )}
                  {checked.errors[`percentage-${member.id}`] && (
                    <p
                      className="financial-error"
                      id={`expense-percentage-${member.id}-error`}
                    >
                      {checked.errors[`percentage-${member.id}`]}
                    </p>
                  )}
                </div>
              ) : draft.split === 'EXACT' &&
                draft.participants.includes(member.id) ? (
                <label>
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
      </fieldset>
      {draft.split === 'PERCENTAGE' && (
        <p
          role="status"
          className={`percentage-status ${checked.errors.participants ? 'percentage-incomplete' : ''}`}
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
              className="financial-error"
              id={`expense-${key}-error`}
              key={key}
            >
              {error}
            </p>
          ))}
    </>
  );
}
