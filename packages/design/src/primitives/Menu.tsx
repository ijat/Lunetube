import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  ariaLabel?: string;
}

export function Menu({ trigger, items, ariaLabel }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lu-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="lu-iconbtn"
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" className="lu-menu__list">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="lu-menu__item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
