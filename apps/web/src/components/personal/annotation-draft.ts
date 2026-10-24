import { createSessionId } from '@/lib/session-id';
import type { personalTransactionDetail$data } from '@/lib/relay/__generated__/personalTransactionDetail.graphql';
import type { BankingAnnotationInput } from '@/lib/relay/__generated__/personalTransactionAnnotationMutation.graphql';
export type Fact = personalTransactionDetail$data;
export const fields = [
  'ACTIVITY',
  'CATEGORY',
  'NOTE',
  'EXCLUDED',
  'REVIEWED',
] as const;
export type AnnotationField = (typeof fields)[number];
export type Values = Record<AnnotationField, string | null>;
/** Bounded actor-owned return geometry; never cached bank facts or signed cursors. */
export type SavedOrigin = {
  href: string;
  focus: string;
  scroll: number;
  pages?: number;
};
export type Edit = {
  version: 1;
  actor: string;
  source: string;
  sourceRevision: string;
  materialRevision: string;
  annotationRevision: string;
  baseline: Values;
  draft: Values;
  pending?: BankingAnnotationInput;
  confirmActivity?: boolean;
  requiresReview?: boolean;
  returnTo?: SavedOrigin;
};
export function annotationValues(fact: Fact): Values {
  return {
    ACTIVITY: fact.activityOverride ?? null,
    CATEGORY: fact.categoryOverride ?? null,
    NOTE: fact.note ?? null,
    EXCLUDED: String(fact.excluded),
    REVIEWED: String(fact.reviewed),
  };
}
export function beginEdit(actor: string, fact: Fact): Edit {
  const baseline = annotationValues(fact);
  return {
    version: 1,
    actor,
    source: fact.sourceId,
    sourceRevision: fact.sourceRevision,
    materialRevision: fact.materialRevision,
    annotationRevision: fact.annotationRevision,
    baseline,
    draft: { ...baseline },
  };
}
export function changedFields(edit: Edit) {
  return fields.filter(
    (field) =>
      edit.draft[field] !== edit.baseline[field] ||
      (field === 'ACTIVITY' && edit.confirmActivity === true),
  );
}
export function annotationError(edit: Edit, fact: Fact) {
  const note = edit.draft.NOTE;
  if (
    note &&
    ([...note].length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(note))
  )
    return 'Private note must contain at most 2,000 characters and no control characters except line breaks and tabs.';
  const activity = edit.draft.ACTIVITY;
  if (
    activity &&
    changedFields(edit).includes('ACTIVITY') &&
    !activityChoices(fact.amountMinor).includes(activity)
  )
    return 'Choose an activity type compatible with the original bank amount.';
  return '';
}
export function activityChoices(amount: string) {
  const value = BigInt(amount);
  return [
    ...(value >= 0n
      ? ['purchase', 'bank_fee', 'debit_interest', 'cash_withdrawal']
      : []),
    ...(value <= 0n ? ['refund', 'income', 'loan_proceeds'] : []),
    'transfer',
    'repayment',
    'unresolved',
  ];
}
/** Only explicit reapplication adopts fresh version fences. Unchanged fields follow the new baseline. */
export function rebaseEdit(edit: Edit, fact: Fact): Edit {
  const next = beginEdit(edit.actor, fact);
  for (const field of changedFields(edit))
    next.draft[field] = edit.draft[field];
  if (edit.confirmActivity) next.confirmActivity = true;
  if (edit.returnTo) next.returnTo = { ...edit.returnTo };
  return next;
}
export function freezeNext(edit: Edit): Edit {
  const field = changedFields(edit)[0];
  if (!field) return edit;
  return {
    ...edit,
    pending: {
      attemptId: createSessionId(),
      sourceId: edit.source,
      sourceRevision: edit.sourceRevision,
      materialRevision: edit.materialRevision,
      expectedRevision: edit.annotationRevision,
      field,
      value: edit.draft[field],
    },
  };
}
export function storageKey(actor: string, source: string) {
  return `kami-personal-annotation:${actor}:${source}`;
}
function values(value: unknown): value is Values {
  return (
    !!value &&
    typeof value === 'object' &&
    fields.every(
      (field) =>
        (value as Values)[field] === null ||
        typeof (value as Values)[field] === 'string',
    )
  );
}
/** Untrusted tab storage never supplies an actor, source identity or command implicitly. */
export function loadEdit(actor: string, source: string): Edit | null {
  const raw: unknown = JSON.parse(
    sessionStorage.getItem(storageKey(actor, source)) ?? 'null',
  );
  if (!raw) return null;
  const edit = raw as Edit;
  if (
    edit.version !== 1 ||
    edit.actor !== actor ||
    edit.source !== source ||
    !values(edit.baseline) ||
    !values(edit.draft) ||
    ![
      edit.sourceRevision,
      edit.materialRevision,
      edit.annotationRevision,
    ].every((value) => typeof value === 'string' && /^\d+$/.test(value))
  )
    throw new Error('INVALID_DRAFT');
  if (
    edit.returnTo &&
    (typeof edit.returnTo.href !== 'string' ||
      edit.returnTo.href.length > 4096 ||
      !edit.returnTo.href.startsWith('/personal?') ||
      typeof edit.returnTo.focus !== 'string' ||
      edit.returnTo.focus.length > 256 ||
      !/^(transaction|current|selected-current)-[A-Za-z0-9-]+$/.test(
        edit.returnTo.focus,
      ) ||
      typeof edit.returnTo.scroll !== 'number' ||
      !Number.isFinite(edit.returnTo.scroll) ||
      edit.returnTo.scroll < 0 ||
      edit.returnTo.scroll > 100000000 ||
      (edit.returnTo.pages !== undefined &&
        (!Number.isInteger(edit.returnTo.pages) ||
          edit.returnTo.pages < 1 ||
          edit.returnTo.pages > 2000)))
  )
    throw new Error('INVALID_RETURN');
  if (
    (edit.requiresReview !== undefined &&
      typeof edit.requiresReview !== 'boolean') ||
    (edit.confirmActivity !== undefined &&
      typeof edit.confirmActivity !== 'boolean')
  )
    throw new Error('INVALID_DRAFT');
  const pending = edit.pending;
  if (
    pending &&
    (typeof pending.attemptId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(pending.attemptId) ||
      pending.sourceId !== source ||
      !fields.includes(pending.field as AnnotationField) ||
      pending.sourceRevision !== edit.sourceRevision ||
      pending.materialRevision !== edit.materialRevision ||
      pending.expectedRevision !== edit.annotationRevision ||
      pending.value !== edit.draft[pending.field as AnnotationField])
  )
    throw new Error('INVALID_ATTEMPT');
  return edit;
}
export function persistEdit(edit: Edit) {
  sessionStorage.setItem(
    storageKey(edit.actor, edit.source),
    JSON.stringify(edit),
  );
}
