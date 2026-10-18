import type { ReactNode } from 'react';
import { cx } from '../ui/classnames';
import { Member } from '../ui/primitives';

import financialPaletteStyles from '../financial/presentation.module.css';
import invitationStyles from './invitations.module.css';

export type Person = {
  id: string;
  displayName: string;
  role: string;
  status: string;
};

/** Membership comes only from the authorized group read, never an invitation. */
export function PeopleList({
  members,
  action,
  children,
}: {
  members: readonly Person[];
  action?: ReactNode;
  children?: ReactNode;
}) {
  const activeCount = members.filter(
    (member) => member.status === 'ACTIVE',
  ).length;
  return (
    <>
      <div
        data-ui="members-heading"
        className={invitationStyles['members-heading']}
      >
        <h2>Members</h2>
        {action}
      </div>
      {children}
      <p data-ui="member-count" className={invitationStyles['member-count']}>
        {activeCount} active {activeCount === 1 ? 'member' : 'members'}
      </p>
      {members.length === 0 && <p>No members to display.</p>}
      <ul
        data-ui="group-members-list"
        className={cx(
          invitationStyles['group-members-list'],
          financialPaletteStyles['member-palette'],
        )}
        aria-label="People"
      >
        {members.map((member) => (
          <li
            key={member.id}
            data-state={member.status === 'ACTIVE' ? 'active' : 'inactive'}
          >
            <Member
              name={member.displayName}
              detail={`${member.role === 'OWNER' ? 'Owner' : 'Member'}${member.status === 'ACTIVE' ? '' : ' · No access; retained in history'}`}
            />
            <span
              data-ui="member-state"
              className={invitationStyles['member-state']}
            >
              {member.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
