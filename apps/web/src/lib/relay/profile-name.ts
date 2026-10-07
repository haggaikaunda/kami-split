/** Unicode White_Space, also used by Go unicode.IsSpace and PostgreSQL btrim.
 * Count Unicode code points after trimming; no NFC conversion or ASCII rule. */
export function normalizedName(value: string) {
  return value.replace(
    /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu,
    '',
  );
}
