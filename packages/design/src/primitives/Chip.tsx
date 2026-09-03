import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: ReactNode;
}

export function Chip({
  selected = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      data-selected={selected}
      aria-pressed={selected}
      className={clsx('lu-chip', className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
