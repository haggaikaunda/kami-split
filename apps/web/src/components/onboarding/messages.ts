const messages: Record<string, string> = {
  TARGET_CONTINUATION_USED:
    'This invitation has already been used to continue an account. Sign in or reset your password to finish joining. If account setup was interrupted, ask the owner for a replacement invitation.',
  INVALID_EMAIL: 'Enter a valid email address. No invitation was saved.',
  INVALID_INPUT: 'Check the original action inputs before submitting again.',
  ORIGINAL_LINK_REQUIRED:
    'Reopen the original application invitation link in this tab. Another tab may have changed the current invitation, or this email callback opened in a new tab.',
  UNAVAILABLE:
    'This service is temporarily unavailable. If you submitted an action, recover its result before trying a new action.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again to continue.',
  VERIFY_EMAIL: 'Verify your current email address before joining.',
  WRONG_ACCOUNT:
    'This invitation is for a different email address. Sign out, then use the invited account.',
  ACCESS_DISABLED: 'Application access is disabled for this account.',
  ACCESS_DENIED: 'This account cannot manage these invitations.',
  CONTEXT_EXPIRED:
    'This onboarding session expired. Reopen the invitation, or start password recovery again.',
  UNAVAILABLE_LINK:
    'This invitation is unavailable. It may have expired, been revoked, or already been accepted. Ask the owner for help.',
  INVALID_CALLBACK:
    'This email link is invalid, expired, already used, or was opened in a different browser. Request another email in this browser.',
  NEW_TARGETED_INVITATION_REQUIRED:
    'Ask the owner for a new invitation to return to this group.',
  NOT_OBSERVED:
    'The original action has no visible result yet. It may still be processing. Keep this recovery context and check again.',
  RATE_LIMITED: 'Too many attempts. Wait a minute before trying again.',
  KEY_REUSED:
    'This action key belongs to different inputs. Recover the original action.',
  NOT_CLAIMABLE:
    'This send is already processing, complete, or no longer eligible. Refresh its status before choosing a new resend.',
};
export function explain(code: string) {
  return (
    messages[code] ??
    'The operation could not be completed. Check the current state before retrying.'
  );
}
