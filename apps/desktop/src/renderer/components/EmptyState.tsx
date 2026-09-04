import type { ReactNode } from 'react';
import './states.css';

/**
 * "There is nothing here, and that is fine" — the counterpart to `ErrorState`.
 * Not a `role="alert"`: an empty result is not an error and must not be
 * announced as one.
 */
export interface EmptyStateProps {
  title: string;
  hint?: string;
  /** A lucide icon, already sized and `aria-hidden`. */
  icon?: ReactNode;
  /** A call to action — e.g. a Button that clears the filters. */
  action?: ReactNode;
}

export function EmptyState({ title, hint, icon, action }: EmptyStateProps) {
  return (
    <div className="state">
      {icon && <span className="state__icon">{icon}</span>}
      <p className="state__title">{title}</p>
      {hint && <p className="state__hint">{hint}</p>}
      {action}
    </div>
  );
}
