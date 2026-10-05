import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import type { ConcreteRequest } from 'relay-runtime';
import repayment from './__generated__/journeyRepaymentMutation.graphql';
import recovery from './__generated__/journeyRepaymentRecoveryQuery.graphql';
import group from './__generated__/journeyGroupQuery.graphql';

const schemaDir = fileURLToPath(
  new URL('../../../../../packages/schema/', import.meta.url),
);
const schema = buildSchema(
  readdirSync(schemaDir)
    .filter((name) => name.endsWith('.graphql'))
    .sort()
    .map((name) => readFileSync(`${schemaDir}/${name}`, 'utf8'))
    .join('\n'),
);
const artifacts = import.meta.glob('./__generated__/*.graphql.ts', {
  eager: true,
}) as unknown as Record<string, { default: ConcreteRequest }>;
describe('compiled operations retain the authoritative server wire contract', () => {
  for (const [path, { default: operation }] of Object.entries(artifacts)) {
    if (operation.kind !== 'Request') continue;
    it(`${path} has a valid server operation`, () => {
      expect(operation.params.text).toBeTypeOf('string');
      expect(validate(schema, parse(operation.params.text!))).toEqual([]);
    });
  }
  it('transmits repayment writes, original-attempt recovery and refreshed group history', () => {
    expect(repayment.params.text).toContain('recordRepayment(input: $input)');
    expect(recovery.params.text).toContain(
      'repaymentOperation(groupId: $groupId, key: $key)',
    );
    expect(group.params.text).toContain('repayments(first: 5)');
    expect(group.params.text).toContain('amountMinor');
  });
});
