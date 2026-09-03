import type { ReactNode } from 'react';

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
}

/** Lightweight CSS hover/focus tooltip — no portal, no timing state. */
export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className="lu-tooltip">
      {children}
      <span role="tooltip" className="lu-tooltip__bubble">
        {label}
      </span>
    </span>
  );
}
