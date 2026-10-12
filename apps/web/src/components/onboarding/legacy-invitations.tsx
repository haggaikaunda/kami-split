'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WorkspaceNavigation } from '@/components/workspace-identity';
import { useOnboarding } from './controller';
import { spaceInvitationsHref } from '@/lib/relay/space-routes';
import '../groups/journey.css';
/** Legacy URLs resolve only their explicit authorized target. This landing
 * never lists private invitations or chooses a workspace for the user. */
export function LegacyInvitations() {
  const c = useOnboarding('invitations');
  const router = useRouter(),
    params = useSearchParams();
  const id = params.get('group');
  const started = useRef('');
  useEffect(() => {
    if (!id || c.loading || !c.session || started.current === id) return;
    started.current = id;
    void c.run(async () => {
      const result = await c.call('/api/graphql', {
        query:
          'query($id:ID!){group(id:$id){__typename ... on Group {id name kind isHousehold viewerMembership{role}}}}',
        variables: { id },
      });
      const group = result.data?.group;
      if (
        group?.__typename !== 'Group' ||
        group.viewerMembership.role !== 'OWNER'
      ) {
        c.tell(
          'This invitation workspace is unavailable. Open a space you can access.',
          true,
        );
        return;
      }
      router.replace(spaceInvitationsHref(group));
    });
  }, [c, id, router]);
  return (
    <main className="financial-journey group-workspace" id="page-content">
      <WorkspaceNavigation />
      <div className="workspace-content">
        <h1>Invitations have moved</h1>
        <p>
          Open Household, a group or a trip, then choose Members → Invitations.
        </p>
        {c.notice && <p role="alert">{c.notice}</p>}
        {c.loading || c.busy ? (
          <p role="status">Checking secure workspace access…</p>
        ) : !c.session ? (
          <Link href="/sign-in">Sign in to open your workspace</Link>
        ) : (
          <Link href="/household">Return to Household</Link>
        )}
      </div>
    </main>
  );
}
