import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
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
} from '../../src/components/primitives';
import '../../src/app/styles.css';
import './preview.css';

function Examples() {
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
      <div className="preview-grid">
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
        title="Edit expense"
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
