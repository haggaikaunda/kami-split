'use client';
import { AppIcon, type IconName } from '../workspace-identity';
import { cx } from '../ui/classnames';
import categoryStyles from './category.module.css';

const categories: Record<string, IconName> = {
  DINING: 'dining',
  GROCERIES: 'groceries',
  ACCOMMODATION: 'bed',
  TRANSPORT: 'car',
  ACTIVITIES: 'activity',
  HOME: 'home',
  OTHER: 'expense',
};
export function CategoryIcon({ category }: { category: string }) {
  return (
    <span
      data-ui={`category-icon category-icon--${category.toLowerCase()}`}
      className={cx(
        categoryStyles['category-icon'],
        categoryStyles[`category-icon--${category.toLowerCase()}`],
      )}
      role="img"
      aria-label={category.toLowerCase()}
    >
      <AppIcon name={categories[category] ?? 'other'} />
    </span>
  );
}
