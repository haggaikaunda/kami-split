/** Plaid's hosted Web SDK: https://plaid.com/docs/link/web/ . Tokens live only in memory. */
export type LinkAccount = {
  id: string;
  name: string;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
};
export type LinkHandler = { open: () => void; destroy: () => void };
export type PlaidSDK = {
  create: (options: {
    token: string;
    onSuccess: (
      token: string | null,
      metadata: { accounts: LinkAccount[] },
    ) => void;
    onExit: (error: { error_code?: string } | null) => void;
  }) => LinkHandler;
};
declare global {
  interface Window {
    Plaid?: PlaidSDK;
  }
}
export async function loadPlaid(): Promise<PlaidSDK> {
  if (window.Plaid) return window.Plaid;
  const source = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
  await new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${source}"]`,
    );
    const timeout = window.setTimeout(() => {
      cleanup();
      script?.remove();
      reject(new Error('LINK_UNAVAILABLE'));
    }, 15000);
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      script?.remove();
      reject(new Error('LINK_UNAVAILABLE'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      script?.removeEventListener('load', ready);
      script?.removeEventListener('error', failed);
    };
    if (!script) {
      script = document.createElement('script');
      script.src = source;
      script.async = true;
    }
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!script.isConnected) document.head.append(script);
  });
  if (!window.Plaid) throw new Error('LINK_UNAVAILABLE');
  return window.Plaid;
}
export function eligibleLinkAccount(account: LinkAccount) {
  return (
    (account.type === 'depository' &&
      ['checking', 'savings'].includes(account.subtype ?? '')) ||
    (account.type === 'credit' && account.subtype === 'credit card')
  );
}
