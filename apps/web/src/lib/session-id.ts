/** Random session/operation identifiers, including on plain-HTTP LAN previews. */
export function createSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  // getRandomValues is available outside secure contexts; retain UUID v4 entropy
  // rather than falling back to timestamps or Math.random for operation IDs.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
