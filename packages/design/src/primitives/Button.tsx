import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * `ghost` — transparent, hover surface. `surface` — muted SurfaceInput fill with
 * hover/active states (Lunegit primary button). `solid` — neutral white fill
 * (`--fg-1` on `--void`), used for "Follow". There is deliberately no
 * accent-filled variant (PRD §7).
 */
export type ButtonVariant = 'ghost' | 'surface' | 'solid';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  iconStart,
  iconEnd,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx('lu-btn', `lu-btn--${variant}`, size === 'sm' && 'lu-btn--sm', className)}
      {...rest}
    >
      {iconStart}
      {children != null && <span>{children}</span>}
      {iconEnd}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx('lu-iconbtn', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
