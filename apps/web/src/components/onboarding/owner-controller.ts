import { explain } from './messages';
import { useState } from 'react';
import { actionFields, type Attempt } from '@/lib/onboarding/client';
import type { Receipt } from './controller';
type Group = { id: string; name: string; isHousehold: boolean; kind: string };
type Invite = {
  kind: string;
  id: string;
  recipient: string | null;
  expiresAt: string;
  lifecycle: string;
  actionID: string | null;
  delivery: string;
};

// Owner operations retain their immutable action context independently of auth screens.
export function useOwnerInvitations({
  graph,
  tell,
  pending,
  showReceipt,
  email,
}: {
  graph: (
    query: string,
    variables?: unknown,
  ) => ReturnType<typeof import('@/lib/onboarding/client').jsonRequest>;
  tell: (message: string, error?: boolean) => void;
  pending: (value: Attempt | null) => void;
  showReceipt: (value: Receipt) => void;
  email: string;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const loadGroups = async () => {
    const data = await graph(
      'query { viewer { __typename ... on Viewer { groups { id name kind isHousehold } } ... on ViewerAccess { state } ... on Problem { code } } }',
    );
    if (data.viewer.__typename !== 'Viewer') {
      tell(
        data.viewer.state === 'UNPROVISIONED'
          ? 'You are signed in. Open your invitation and explicitly join to gain group access.'
          : explain(data.viewer.state ?? data.viewer.code),
        true,
      );
      return;
    }
    setGroups(data.viewer.groups);
    if (!data.viewer.groups.length)
      tell('No accessible groups yet. Open your invitation to join.');
  };
  const loadInvites = async (id: string, after: string | null = null) => {
    if (!after) {
      setInvites([]);
      setNext(null);
    }
    const data = await graph(
      'query($groupID:ID!,$after:ID){ownerInvitations(groupID:$groupID,first:20,after:$after){__typename ... on OwnerInvitationPage { items{id kind recipient expiresAt lifecycle actionID delivery} nextCursor } ... on InvitationProblem {code}}}',
      { groupID: id, after },
    );
    if (data.ownerInvitations.code) throw new Error(data.ownerInvitations.code);
    setInvites((old) =>
      after
        ? [...old, ...data.ownerInvitations.items]
        : data.ownerInvitations.items,
    );
    setNext(data.ownerInvitations.nextCursor);
    if (!data.ownerInvitations.items.length && !after)
      tell('No invitations yet.');
  };
  const send = async (actionID: string) => {
    const data = await graph(
      'mutation($actionID:ID!){retryInvitationDelivery(actionID:$actionID){__typename ... on InvitationDeliveryResult {status} ... on InvitationProblem {code}}}',
      { actionID },
    );
    if (data.retryInvitationDelivery.code)
      throw new Error(data.retryInvitationDelivery.code);
    tell(
      'Send attempted. Refresh invitations to see the recorded provider status; provider acceptance does not guarantee arrival.',
    );
  };
  const ownerAction = async (
    kind: 'CREATE' | 'RESEND' | 'REVOKE' | 'CREATE_SHARED' | 'RENEW_SHARED',
    id?: string,
    original?: Attempt,
  ) => {
    const value: Attempt = original ?? {
      kind,
      key: crypto.randomUUID(),
      groupID: group,
      ...(id ? { invitationID: id } : {}),
    };
    pending(value);
    const name =
      kind === 'CREATE_SHARED'
        ? 'createSharedInvitation'
        : kind === 'RENEW_SHARED'
          ? 'renewSharedInvitation'
          : kind === 'CREATE'
            ? 'createTargetedInvitation'
            : kind === 'RESEND'
              ? 'resendInvitation'
              : 'revokeInvitation';
    const query =
      kind === 'CREATE_SHARED'
        ? `mutation($groupID:ID!,$key:OperationKey!){${name}(groupID:$groupID,key:$key){${actionFields}}}`
        : kind === 'CREATE'
          ? `mutation($groupID:ID!,$email:String!,$key:OperationKey!){${name}(groupID:$groupID,email:$email,key:$key){${actionFields}}}`
          : `mutation($groupID:ID!,$id:ID!,$key:OperationKey!){${name}(groupID:$groupID,id:$id,key:$key){${actionFields}}}`;
    const data = await graph(query, {
      groupID: value.groupID,
      id: value.invitationID,
      email,
      key: value.key,
    });
    const result = data[name] as Receipt;
    showReceipt(result);
    if (
      result.actionID &&
      result.delivery === 'PENDING' &&
      result.outcome !== 'EXISTING' &&
      kind !== 'REVOKE'
    ) {
      await send(result.actionID);
    }
    await loadInvites(value.groupID ?? group);
  };

  return {
    groups,
    setGroups,
    group,
    setGroup,
    invites,
    setInvites,
    next,
    loadGroups,
    loadInvites,
    send,
    ownerAction,
  };
}
