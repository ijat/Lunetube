import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchSuggestions } from '../lib/queries.js';

/**
 * Top-bar search suggestions dropdown (plan P2-8). Owns the whole combobox —
 * the `<input>` AND the `role="listbox"` popup — so the ARIA wiring
 * (`role="combobox"` / `aria-expanded` / `aria-activedescendant` on the input,
 * `role="listbox"` on the popup) lives in one place. `TopBar` renders this in
 * place of a bare `<input>`, keeping its own `<Search>` icon and `<form
 * onSubmit>` around it.
 *
 * Debounces the raw `value` by 180ms before handing it to
 * `useSearchSuggestions` — that hook does NOT debounce itself (P2-6).
 *
 * A suggestions query failure renders NOTHING (P2-F7): `data` is simply
 * `undefined` in that case, and the popup only ever renders when there is at
 * least one row — no dedicated error branch to accidentally show.
 */
export interface SearchSuggestionsProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired when the user picks a suggestion (Enter on a highlighted row, or a click). */
  onCommit: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

const MAX_ROWS = 8;
const DEBOUNCE_MS = 180;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function SearchSuggestions({
  id,
  value,
  onChange,
  onCommit,
  placeholder,
  ariaLabel,
}: SearchSuggestionsProps) {
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);
  const { data } = useSearchSuggestions(debounced);
  const suggestions = (data ?? []).slice(0, MAX_ROWS);

  const [focused, setFocused] = useState(false);
  const [closed, setClosed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const open = focused && !closed && suggestions.length > 0;
  // Clamp against the list's live length rather than resetting `highlighted`
  // via an effect keyed on `suggestions` — the debounced query reshuffles the
  // array on every keystroke, and a shrinking list must not point
  // `aria-activedescendant` at a row that no longer exists.
  const activeIndex = highlighted < suggestions.length ? highlighted : -1;
  const listId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // Click-away: a click on a non-focusable element does not blur the input in
  // a real browser, so closing on blur alone misses "clicked empty space".
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const commit = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      onCommit(suggestion);
      setClosed(true);
      setHighlighted(-1);
    },
    [onChange, onCommit],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setClosed(false);
      setHighlighted((activeIndex + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setClosed(false);
      setHighlighted((activeIndex - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === 'Enter') {
      if (!open || activeIndex < 0) return; // let the form submit normally
      const picked = suggestions[activeIndex];
      if (picked === undefined) return;
      e.preventDefault();
      commit(picked);
      return;
    }
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      setClosed(true);
      setHighlighted(-1);
    }
  };

  return (
    <div className="search-suggest" ref={containerRef}>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        value={value}
        onChange={(e) => {
          // Real typing (as opposed to `commit()`, which calls `onChange`
          // directly) always re-opens — the user is looking for suggestions
          // again even right after an Escape.
          setClosed(false);
          setHighlighted(-1);
          onChange(e.currentTarget.value);
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="search-suggest__popup no-drag"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? 'search-suggest__option is-active'
                  : 'search-suggest__option'
              }
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(suggestion)}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
