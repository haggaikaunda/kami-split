import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WorkspaceHeader,
  WorkspaceTabs,
  SummaryMetric,
  SignedBalanceMetric,
  SpaceChip,
  ExpenseRow,
  MonthSection,
  FilterBar,
  BalanceSpaceRow,
  MemberBalanceRow,
  RecommendedRepaymentRow,
  Button,
  Card,
  ChartTable,
  Confirmation,
  Dialog,
  EmptyState,
  ErrorSummary,
  Field,
  Member,
  Money,
  SelectField,
  Skeleton,
  Status,
  Toast,
} from '../../apps/web/src/components/primitives';
import '../../apps/web/src/app/styles.css';
import './preview.css';

function Examples() {
  const [workspace, setWorkspace] = useState('Household');
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState('No period selected');
  const [textSize, setTextSize] = useState('100');
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize =
      textSize === '200' ? '32px' : '16px';
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [textSize]);
  return (
    <main>
      <p>Development examples · simulated data</p>
      <h1>Shared UI primitives</h1>
      <SelectField
        label="Example text size"
        value={textSize}
        onChange={(event) => setTextSize(event.target.value)}
      >
        <option value="100">100%</option>
        <option value="200">200%</option>
      </SelectField>
      <SelectField
        label="Example workspace"
        value={workspace}
        onChange={(event) => setWorkspace(event.target.value)}
      >
        <option>Household</option>
        <option>A week in Maui with our friends and extended family</option>
      </SelectField>
      <WorkspaceHeader
        title={workspace}
        context={
          <>
            <SpaceChip>
              {workspace === 'Household' ? 'Household' : 'Trip'}
            </SpaceChip>{' '}
            · 2 members
          </>
        }
      >
        <Button onClick={() => setDialog(true)}>Add expense</Button>
      </WorkspaceHeader>
      <WorkspaceTabs
        current="Expenses"
        hrefFor={(section) => `#example-${section.toLowerCase()}`}
      />
      <div className="ui-summary-row">
        <SummaryMetric
          label="Total shared expenses"
          detail="All dates · 3 expenses"
        >
          <Money value="9,999,999.99" currency="USD" />
        </SummaryMetric>
        <SignedBalanceMetric
          position="positive"
          value="1,234.56"
          currency="USD"
          detail="Informational · 2 spaces have open balances"
        />
      </div>
      <FilterBar>
        <Field
          label="Search expenses"
          type="search"
          placeholder="Find an expense"
        />
        <SelectField label="Space">
          <option>All spaces</option>
          <option>Household</option>
        </SelectField>
      </FilterBar>
      <MonthSection title="September 2026">
        <ExpenseRow
          href="#example-detail"
          description="Shared groceries for our family gathering with a very long description"
          metadata="Sep 20 · Alex paid · Food"
          space={workspace}
          value="9,999,999.99"
          currency="USD"
        />
        <ExpenseRow
          href="#example-detail"
          description="Train tickets"
          metadata="Sep 19 · Sam paid · Transport"
          space="A week in Maui"
          value="150.00"
          currency="USD"
        />
      </MonthSection>
      <section aria-label="Balance examples">
        <BalanceSpaceRow space="Household" href="#example-balances">
          <SignedBalanceMetric
            position="negative"
            value="30.00"
            currency="USD"
          />
        </BalanceSpaceRow>
        <MemberBalanceRow name="Alexandria Morgan with an exceptionally long family name">
          <SignedBalanceMetric
            position="positive"
            value="30.00"
            currency="USD"
          />
        </MemberBalanceRow>
        <MemberBalanceRow name="Sam">
          <SignedBalanceMetric position="zero" value="0.00" currency="USD" />
        </MemberBalanceRow>
        <RecommendedRepaymentRow
          group="A week in Maui"
          sender="Sam"
          recipient="Alex"
          value="30.00"
          currency="USD"
          action={
            <Button tone="secondary" onClick={() => setDialog(true)}>
              Record repayment example
            </Button>
          }
        />
      </section>
      <p>
        Example links demonstrate navigation styling only. Product routes are
        integrated in later redesign slices.
      </p>
      <div className="preview-grid">
        <Card title="Informational Household aggregate">
          <SignedBalanceMetric
            scope="household"
            position="zero"
            value="0.00"
            currency="USD"
            detail="2 spaces have open balances. Net zero does not mean the spaces are settled."
          />
        </Card>
        <Card title="Exact money" balance>
          <Money value="9,999,999.99" currency="USD" />
          <p>Paid amounts stay exact. Currency remains visible.</p>
          <Member
            name="Alex Morgan"
            photo="/intentionally-missing-photo.png"
            detail="Photo fallback example"
          />
        </Card>
        <Card title="Labeled controls">
          <Field
            id="amount"
            label="Amount (USD)"
            inputMode="decimal"
            hint="Use up to two decimal places."
            error="Enter a positive amount."
            defaultValue="0"
          />
          <SelectField label="Paid by">
            <option>Alex Morgan</option>
            <option>Sam</option>
          </SelectField>
          <Field label="Effective date" type="date" defaultValue="2026-09-20" />
          <ErrorSummary
            errors={[
              { fieldId: 'amount', message: 'Enter a positive amount.' },
            ]}
          />
          <div className="ui-actions">
            <Button onClick={() => setDialog(true)}>Open expense dialog</Button>
            <Button tone="danger" onClick={() => setConfirm(true)}>
              Discard draft
            </Button>
            <Button pending>Save</Button>
          </div>
        </Card>
        <Card title="Named recovery states">
          <div className="preview-stack">
            <Skeleton />
            <Status kind="pending">Saving your changes…</Status>
            <Status kind="error">
              Save failed. Your draft is still available.
            </Status>
            <Status kind="stale">
              This record changed. Compare before retrying.
            </Status>
            <Status kind="denied">This record is unavailable.</Status>
            <Toast>Expense saved. Updated values appear in the view.</Toast>
          </div>
        </Card>
        <Card title="Empty and filtered empty">
          <EmptyState
            title="No expenses yet"
            action={<Button>Add expense</Button>}
          >
            Add your first shared expense.
          </EmptyState>
          <EmptyState
            title="No matching expenses"
            action={<Button tone="secondary">Clear filters</Button>}
          >
            Try clearing your filters.
          </EmptyState>
        </Card>
        <Card title="Chart and exact table">
          <ChartTable
            title="September 2026"
            currency="USD"
            rows={[
              {
                id: 'sep20',
                label: 'Sep 20',
                value: '10.01',
                count: 2,
                magnitude: 1001,
              },
              {
                id: 'sep21',
                label: 'Sep 21',
                value: '0.00',
                count: 0,
                magnitude: 0,
              },
            ]}
            onSelect={setSelected}
          />
          <p role="status">{selected}</p>
        </Card>
      </div>
      <Dialog
        open={dialog}
        title="Expense example"
        panel
        onClose={() => setDialog(false)}
      >
        <Field label="Description" defaultValue="Shared groceries" />
        <Field label="Amount (USD)" defaultValue="10.01" />
        <div className="ui-actions">
          <Button onClick={() => setDialog(false)}>Save example</Button>
          <Button tone="secondary" onClick={() => setDialog(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
      <Confirmation
        open={confirm}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        onCancel={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
      >
        Your unsaved draft will be discarded. No financial record changes.
      </Confirmation>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Examples />);
