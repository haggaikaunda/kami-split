import { BrandMark } from './brand-mark';
import { cx } from './ui/classnames';
import styles from './brand.module.css';

/** Public presentation only: no session, navigation, fetching or theme lifecycle. */
export function Brand({ className }: { className?: string }) {
  return (
    <span data-ui="workspace-brand" className={cx(styles.brand, className)}>
      <BrandMark className={styles.mark} />
      <span>Kami Grow</span>
    </span>
  );
}
