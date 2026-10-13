/** Join optional component and caller-owned classes without emitting false values. */
export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
