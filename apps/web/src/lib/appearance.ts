export type Appearance = 'LIGHT' | 'SYSTEM' | 'DARK';
export const appearanceCacheKey = 'kami-appearance';
export function appearance(value: unknown): Appearance {
  return value === 'LIGHT' || value === 'DARK' ? value : 'SYSTEM';
}
export function applyAppearance(value: Appearance) {
  let dark = false;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    // Light is the technical fallback when device detection is unavailable.
  }
  document.documentElement.dataset.appearance = value;
  document.documentElement.dataset.theme =
    value === 'DARK' || (value === 'SYSTEM' && dark) ? 'dark' : 'light';
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-chrome')
    .trim();
  if (color)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', color);
}
export function cachedAppearance(actor: string): Appearance {
  try {
    const cached = JSON.parse(
      localStorage.getItem(appearanceCacheKey) ?? 'null',
    );
    return cached &&
      !Array.isArray(cached) &&
      cached.actor === actor &&
      ['LIGHT', 'DARK', 'SYSTEM'].includes(cached.value)
      ? cached.value
      : 'SYSTEM';
  } catch {
    return 'SYSTEM';
  }
}
export function cacheAppearance(actor: string, value: Appearance) {
  try {
    localStorage.setItem(appearanceCacheKey, JSON.stringify({ actor, value }));
  } catch {
    // Persistence belongs to the API; an unavailable paint cache is harmless.
  }
}
export function clearAppearanceCache() {
  try {
    localStorage.removeItem(appearanceCacheKey);
  } catch {
    // Presentation storage must not interfere with private-state disposal.
  }
}
/** Runs synchronously in the document head. The supported session cookie binds
 * paint only; neither cached presentation nor cookie parsing authorizes access.
 * Keep validation/resolution in parity with cachedAppearance/applyAppearance. */
export const appearanceBootstrap = `(()=>{
let value='SYSTEM',dark=false;
try{
 const cookies=Object.fromEntries(document.cookie.split('; ').map(part=>{const i=part.indexOf('=');return [part.slice(0,i),part.slice(i+1)]}));
 let raw=cookies['kami-auth'];
 if(!raw){raw='';for(let i=0;cookies['kami-auth.'+i]!==undefined;i++)raw+=cookies['kami-auth.'+i]}
 raw=decodeURIComponent(raw||'');
 if(raw.startsWith('base64-'))raw=new TextDecoder().decode(Uint8Array.from(atob(raw.slice(7).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
 const session=JSON.parse(raw||'null');
 const cached=JSON.parse(localStorage.getItem('kami-appearance')||'null');
 if(typeof session?.user?.id==='string'&&session.user.id&&cached&&!Array.isArray(cached)&&cached.actor===session.user.id&&['LIGHT','DARK','SYSTEM'].includes(cached.value))value=cached.value;
}catch{}
try{dark=matchMedia('(prefers-color-scheme: dark)').matches}catch{}
document.documentElement.dataset.appearance=value;
document.documentElement.dataset.theme=value==='DARK'||(value==='SYSTEM'&&dark)?'dark':'light';
requestAnimationFrame(()=>{const color=getComputedStyle(document.documentElement).getPropertyValue('--color-chrome').trim();if(color)document.querySelector('meta[name="theme-color"]')?.setAttribute('content',color)});
})()`;
