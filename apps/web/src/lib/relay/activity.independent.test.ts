import { expect, it } from 'vitest';
import group from './__generated__/activityGroupQuery.graphql';
import household from './__generated__/activityHouseholdQuery.graphql';
import detail from './__generated__/activityDetailQuery.graphql';

it('sends executable server operations for both activity feeds and historical detail', () => {
  expect(group.params.text).toContain('groupActivity(');
  expect(household.params.text).toContain('householdActivity(');
  expect(detail.params.text).toContain('activityEvent(eventId:');
});
