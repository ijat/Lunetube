import { AlertTriangle } from 'lucide-react';
import { Button } from '@lunetube/design';
import './states.css';

/**
 * The presentational half of a failed query. It is deliberately dumb — the
 * route decides what `message` and `hint` say (a `LuneError` carries both a
 * `message` and a `hint`, and `retryable` decides whether `onRetry` is passed at
 * all), so this component never has to know about IPC.
 */
export interface ErrorStateProps {
  /** What went wrong, in the user's terms. */
  message: string;
  /** What they can do about it, if anything. */
  hint?: string;
  /** Omit for a non-retryable failure — a Retry button that cannot help is worse than none. */
  onRetry?: () => void;
}

export function ErrorState({ message, hint, onRetry }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <AlertTriangle className="state__icon" size={22} strokeWidth={1.6} aria-hidden="true" />
      <p className="state__title">{message}</p>
      {hint && <p className="state__hint">{hint}</p>}
      {onRetry && (
        <Button variant="surface" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
