import { Chip, Segmented, type SegmentedOption } from '@lunetube/design';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchDuration,
  type SearchFilters,
  type SearchResultType,
  type SearchSort,
  type SearchUploadDate,
} from '@lunetube/shared';

/**
 * The four search filter groups (plan P2-8), styled to the mockup's
 * `.filters .f` via `search.css` (`.filters .f` selector — the `f` class name
 * is the mockup's own, kept so the CSS reads as a direct port). Sort is a
 * two-option `Segmented` (Relevance | View count, decision A3 — no Rating);
 * upload date / duration / type are `Chip` rows. **No "Last hour" chip**
 * (decision A14) and duration is labelled Short/Medium/Long, not concrete
 * minute ranges (plan P2-8 — the proto names don't match YouTube's own UI
 * numbers and which one the server applies is unverified without a live call).
 */
export interface SearchFilterBarProps {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}

const SORT_OPTIONS: SegmentedOption<SearchSort>[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'views', label: 'View count' },
];

const UPLOAD_DATE_OPTIONS: { value: SearchUploadDate; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

const DURATION_OPTIONS: { value: SearchDuration; label: string }[] = [
  { value: 'any', label: 'Any length' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

const TYPE_OPTIONS: { value: SearchResultType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Videos' },
  { value: 'channel', label: 'Channels' },
  { value: 'playlist', label: 'Playlists' },
];

/** Human labels for the removable-chip summary the empty state shows. */
export const FILTER_FIELD_LABELS: {
  sort: Record<SearchSort, string>;
  uploadDate: Record<SearchUploadDate, string>;
  duration: Record<SearchDuration, string>;
  type: Record<SearchResultType, string>;
} = {
  sort: Object.fromEntries(SORT_OPTIONS.map((o) => [o.value, o.label])) as Record<
    SearchSort,
    string
  >,
  uploadDate: Object.fromEntries(UPLOAD_DATE_OPTIONS.map((o) => [o.value, o.label])) as Record<
    SearchUploadDate,
    string
  >,
  duration: Object.fromEntries(DURATION_OPTIONS.map((o) => [o.value, o.label])) as Record<
    SearchDuration,
    string
  >,
  type: Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<
    SearchResultType,
    string
  >,
};

export interface ActiveFilterEntry {
  field: keyof SearchFilters;
  label: string;
  /**
   * Returns `filters` with just this field reset to its default. Built as a
   * concrete per-field closure (not a generic `[field]: value` computed
   * assignment) — indexing `SearchFilters` by a plain `keyof SearchFilters`
   * union does not correlate the key to its own value type, so that pattern
   * would type-check the wrong thing rather than the wrong thing loudly.
   */
  reset: (filters: SearchFilters) => SearchFilters;
}

/** Non-default filters, for the empty state's removable-chip summary. */
export function activeFilterEntries(filters: SearchFilters): ActiveFilterEntry[] {
  const entries: ActiveFilterEntry[] = [];
  if (filters.sort !== DEFAULT_SEARCH_FILTERS.sort) {
    entries.push({
      field: 'sort',
      label: FILTER_FIELD_LABELS.sort[filters.sort],
      reset: (f) => ({ ...f, sort: DEFAULT_SEARCH_FILTERS.sort }),
    });
  }
  if (filters.uploadDate !== DEFAULT_SEARCH_FILTERS.uploadDate) {
    entries.push({
      field: 'uploadDate',
      label: FILTER_FIELD_LABELS.uploadDate[filters.uploadDate],
      reset: (f) => ({ ...f, uploadDate: DEFAULT_SEARCH_FILTERS.uploadDate }),
    });
  }
  if (filters.duration !== DEFAULT_SEARCH_FILTERS.duration) {
    entries.push({
      field: 'duration',
      label: FILTER_FIELD_LABELS.duration[filters.duration],
      reset: (f) => ({ ...f, duration: DEFAULT_SEARCH_FILTERS.duration }),
    });
  }
  if (filters.type !== DEFAULT_SEARCH_FILTERS.type) {
    entries.push({
      field: 'type',
      label: FILTER_FIELD_LABELS.type[filters.type],
      reset: (f) => ({ ...f, type: DEFAULT_SEARCH_FILTERS.type }),
    });
  }
  return entries;
}

export function SearchFilterBar({ filters, onChange }: SearchFilterBarProps) {
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="filters">
      <Segmented
        options={SORT_OPTIONS}
        value={filters.sort}
        onChange={(v) => set('sort', v)}
        ariaLabel="Sort by"
      />
      <div className="filters__group" role="group" aria-label="Upload date">
        {UPLOAD_DATE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            className="f"
            selected={filters.uploadDate === opt.value}
            onClick={() => set('uploadDate', opt.value)}
          >
            {opt.label}
          </Chip>
        ))}
      </div>
      <div className="filters__group" role="group" aria-label="Duration">
        {DURATION_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            className="f"
            selected={filters.duration === opt.value}
            onClick={() => set('duration', opt.value)}
          >
            {opt.label}
          </Chip>
        ))}
      </div>
      <div className="filters__group" role="group" aria-label="Result type">
        {TYPE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            className="f"
            selected={filters.type === opt.value}
            onClick={() => set('type', opt.value)}
          >
            {opt.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
