export function financialReadMessage(code: string) {
  if (['NOT_FOUND', 'DISABLED', 'UNPROVISIONED'].includes(code))
    return 'This account cannot access the requested financial data.';
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_CHANGED')
    return 'Your session is unavailable. Sign in again before continuing.';
  if (code === 'INVALID_CURSOR')
    return 'This expense page is no longer available. Restart the list.';
  return 'Financial data is unavailable. No zero balance or settled status can be established. Refresh to try again.';
}
