import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * The mockup's `.ctl .pill` (docs/mockups.html L370–374) and the popover behind
 * the quality/speed pills.
 *
 * Shared rather than duplicated three ways because F5 requires the CC, speed
 * and quality pills to be visually identical, and because `@lunetube/design`'s
 * `Menu` primitive hard-codes an icon-button trigger with no checked state —
 * wrong shape here, and widening it would be Phase-4 scope creep.
 *
 * **Typography note (F5 conflict 1):** the mockup sets `font-family:
 * var(--font-mono)` on `.ctl .pill`. PRD §7/§11.2 are LOCKED — no monospace
 * anywhere — so `.player__pill` uses `var(--font-body)` (Hanken Grotesk) with
 * `font-variant-numeric: tabular-nums` instead. Same for `.player__time`.
 */

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface PillProps {
  children: ReactNode;
  /** Accent-tinted — the mockup's `.pill.hot`. */
  hot?: boolean;
  label: string;
  onClick?: () => void;
  pressed?: boolean;
}

export function Pill({ children, hot = false, label, onClick, pressed }: PillProps) {
  return (
    <button
      type="button"
      className={cx('player__pill', hot && 'player__pill--hot')}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface PillMenuOption<T> {
  value: T;
  label: string;
}

export interface PillMenuProps<T> {
  /** Rendered inside the pill trigger. */
  trigger: ReactNode;
  label: string;
  options: readonly PillMenuOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  hot?: boolean;
}

export function PillMenu<T extends string | number>({
  trigger,
  label,
  options,
  value,
  onSelect,
  hot = false,
}: PillMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // Stop the player's global `Escape`/shortcut handling from also firing.
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="player__pillmenu" ref={rootRef}>
      <button
        type="button"
        className={cx('player__pill', hot && 'player__pill--hot')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { 'aria-controls': menuId } : {})}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className="player__pillmenu-list" role="menu" id={menuId} aria-label={label}>
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              className={cx('player__pillmenu-item', option.value === value && 'is-selected')}
              onClick={() => {
                setOpen(false);
                onSelect(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
