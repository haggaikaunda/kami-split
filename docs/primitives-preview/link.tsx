import type { AnchorHTMLAttributes } from 'react';

/** Gallery links keep native hash navigation without a production Next router. */
export default function GalleryLink({
  scroll,
  onNavigate,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  scroll?: boolean;
  onNavigate?: (event: { preventDefault(): void }) => void;
}) {
  void scroll;
  return (
    <a
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) onNavigate?.(event);
      }}
    />
  );
}

export function useLinkStatus() {
  return { pending: false };
}
