import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** `panel` uses the single allowed blur layer; `flat` is a nested surface (no blur). */
  surface?: 'panel' | 'flat';
}

export function Panel({ surface = 'panel', className, children, ...rest }: PanelProps) {
  return (
    <div
      className={clsx('lu-panel', surface === 'panel' ? 'glass-panel' : 'glass-flat', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
