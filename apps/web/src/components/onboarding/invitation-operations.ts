export const actionFields =
  '__typename ... on InvitationActionResult { actionID invitationID groupID outcome committedExpiresAt currentExpiresAt lifecycle delivery hasAccess } ... on InvitationProblem { code message }';
export const recoveryQuery = `query($kind:InvitationOperation!,$key:OperationKey!){ invitationAction(kind:$kind,key:$key){${actionFields}} }`;
