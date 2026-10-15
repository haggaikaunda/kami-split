import { cx } from '../ui/classnames';
import { Member } from '../ui/primitives';
import type { ReactNode } from 'react';

import financialPaletteStyles from '../financial/presentation.module.css';
import invitationStyles from './invitations.module.css';
import workspaceFeatureStyles from '../groups/workspace.module.css';

export type Person = {
  id: string;
  displayName: string;
  role: string;
  status: string;
};

/** Membership comes only from the authorized group read, never an invitation. */
export function PeopleList({
  members,
  children,
}: {
  members: readonly Person[];
  children?: ReactNode;
}) {
  return (
    <ul
      data-ui="group-members-list account-rows"
      className={cx(
        cx(
          workspaceFeatureStyles['group-members-list'],
          invitationStyles['account-rows'],
        ),
        financialPaletteStyles['member-palette'],
      )}
      aria-label="People"
    >
      {members.map((member) => (
        <li key={member.id}>
          <Member
            name={member.displayName}
            detail={`${member.role === 'OWNER' ? 'Owner' : 'Member'} · ${member.status === 'ACTIVE' ? 'Active' : 'Inactive · No access; retained in history'}`}
          />
        </li>
      ))}
      {children}
    </ul>
  );
}
