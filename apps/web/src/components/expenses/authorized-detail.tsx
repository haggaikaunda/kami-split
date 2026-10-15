'use client';
import { useEffect, useEffectEvent } from 'react';
import { readInlineData } from 'relay-runtime';
import { NetworkQuery } from '@/lib/relay/query';
import { ExpenseDetail } from '@/components/groups/expense-detail';
import type { FinancialScope } from '@/lib/relay/environment';
import viewDocument, {
  type expensesView$key,
} from '@/lib/relay/__generated__/expensesView.graphql';
import groupDocument, {
  type expensesGroupQuery,
} from '@/lib/relay/__generated__/expensesGroupQuery.graphql';
import householdDocument, {
  type expensesHouseholdQuery,
} from '@/lib/relay/__generated__/expensesHouseholdQuery.graphql';

import detailFeatureStyles from '../groups/expense-detail.module.css';

type Props = {
  scope: FinancialScope;
  groupId: string;
  source: string;
  id: string;
  onDenied: () => void;
  onCommitted: () => Promise<void>;
};
/** Reauthorizes the original source in its current Group/Household context before
 * loading the current expense. The source read is not another ledger traversal. */
export function AuthorizedDetail(props: Props) {
  const { scope, groupId, source, onDenied } = props;
  const fallback = <p role="status">Loading expense…</p>;
  const failure = <SourceUnavailable onDenied={onDenied} />;
  return groupId ? (
    <NetworkQuery<expensesGroupQuery>
      scope={scope}
      document={groupDocument}
      variables={{ groupId, filter: { groupId: source } }}
      fallback={fallback}
      failure={failure}
    >
      {(result) => <SourceDetail {...props} reference={result.groupExpenses} />}
    </NetworkQuery>
  ) : (
    <NetworkQuery<expensesHouseholdQuery>
      scope={scope}
      document={householdDocument}
      variables={{ filter: { groupId: source } }}
      fallback={fallback}
      failure={failure}
    >
      {(result) => (
        <SourceDetail {...props} reference={result.householdExpenses} />
      )}
    </NetworkQuery>
  );
}
function SourceDetail({
  reference,
  scope,
  source,
  id,
  onDenied,
  onCommitted,
}: Props & { reference: expensesView$key }) {
  const view = readInlineData(viewDocument, reference);
  if (view.__typename !== 'ExpenseView')
    return <SourceUnavailable onDenied={onDenied} />;
  return (
    <>
      <p
        data-ui="expense-detail-source"
        className={detailFeatureStyles['expense-detail-source']}
      >
        Source: {view.edges[0]?.source.name ?? 'Authorized source space'}
      </p>
      <ExpenseDetail
        scope={scope}
        group={source}
        id={id}
        onUnavailable={onDenied}
        onCommitted={onCommitted}
      />
    </>
  );
}
function SourceUnavailable({ onDenied }: { onDenied: () => void }) {
  const deny = useEffectEvent(onDenied);
  useEffect(() => {
    deny();
  }, []);
  return <p role="alert">Expense unavailable.</p>;
}
