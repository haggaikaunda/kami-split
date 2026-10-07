export type Appearance = 'LIGHT' | 'SYSTEM' | 'DARK';
export const appearanceCacheKey = 'kami-appearance';
export function appearance(value: unknown): Appearance {
  return value === 'DARK' || value === 'SYSTEM' ? value : 'LIGHT';
}
export function applyAppearance(value: Appearance) {
  document.documentElement.dataset.theme =
    value === 'DARK' ||
    (value === 'SYSTEM' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light';
}
export function cachedAppearance(actor: string): Appearance {
  try {
    const cached = JSON.parse(
      localStorage.getItem(appearanceCacheKey) ?? 'null',
    );
    return cached?.actor === actor ? appearance(cached.value) : 'LIGHT';
  } catch {
    return 'LIGHT';
  }
}
export function cacheAppearance(actor: string, value: Appearance) {
  try {
    localStorage.setItem(appearanceCacheKey, JSON.stringify({ actor, value }));
  } catch {
    // Persistence belongs to the API; an unavailable paint cache is harmless.
  }
}
/** Runs synchronously in the document head. Cached presentation is never identity
 * or authorization evidence; the authenticated profile replaces it after startup. */
export const appearanceBootstrap = `(()=>{let value='LIGHT';try{const session=JSON.parse(localStorage.getItem('kami-auth')||'null');const cached=JSON.parse(localStorage.getItem('kami-appearance')||'null');if(session?.user?.id&&session.user.id===cached?.actor&&(cached.value==='DARK'||cached.value==='SYSTEM'))value=cached.value}catch{}document.documentElement.dataset.theme=value==='DARK'||(value==='SYSTEM'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'})()`;
