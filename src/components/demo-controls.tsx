'use client';
import { useState } from 'react';
import type { Fixture, Scenario } from '@/lib/data/port';
import { useAppData } from './data-provider';
import { useExpenseNavigation } from './navigation/provider';
import { Button, Confirmation, SelectField } from './primitives';
const scenarios: { value: Scenario; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow loading' },
  { value: 'offline', label: 'Offline' },
  { value: 'denied', label: 'Access denied' },
  { value: 'expired', label: 'Session expired' },
  { value: 'timeout-after-commit', label: 'Timeout after commit' },
  { value: 'second-editor', label: 'Second editor' },
  { value: 'concurrent-delete', label: 'Concurrent deletion' },
];
export function DemoPanel({ active = true }: { active?: boolean }) {
  const { demo, snapshot } = useAppData();
  const { drafts } = useExpenseNavigation();
  const [fixture, setFixture] = useState<Fixture>('sample');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [confirm, setConfirm] = useState(false);
  if (!demo) return null;
  const pending = Object.values(drafts).some((draft) => draft.pending);
  return (
    <details className="demo-controls">
      <summary>Simulation controls</summary>
      <p>
        Deterministic examples only. Access checks here are simulations, not
        server security.
      </p>
      <div className="demo-control-grid">
        <SelectField
          label="Scenario"
          value={scenario}
          onChange={(event) => {
            const value = event.target.value as Scenario;
            setScenario(value);
            demo.scenario(value);
          }}
        >
          {scenarios.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {snapshot && (
          <SelectField
            label="Simulated actor"
            value={snapshot.actorId}
            onChange={(event) => demo.actor(event.target.value)}
          >
            {snapshot.members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          label="Fixture for reset"
          value={fixture}
          onChange={(event) => setFixture(event.target.value as Fixture)}
        >
          <option value="sample">Sample household</option>
          <option value="empty">Empty household</option>
          <option value="three-members">Three members</option>
        </SelectField>
      </div>
      <Button
        tone="secondary"
        disabled={pending}
        onClick={() => setConfirm(true)}
      >
        Reset simulation
      </Button>
      {pending && <p>Finish the pending request before resetting.</p>}
      <Confirmation
        open={confirm && active}
        title="Reset this simulation?"
        confirmLabel="Reset simulation"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          demo.reset(fixture);
          setScenario('normal');
          setConfirm(false);
        }}
      >
        This restores the selected fixture and discards unsaved session drafts.
        These are simulated records.
      </Confirmation>
    </details>
  );
}
