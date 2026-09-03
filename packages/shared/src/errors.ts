/**
 * The single closed error surface for the whole app (PRD §8: "a single 'YouTube
 * changed something' error surface with retry + a diagnostics panel"). Every
 * `Result` failure carries one of these.
 */
export type LuneErrorCode =
  | 'YT_UNAVAILABLE'
  | 'YT_LOGIN_REQUIRED'
  | 'YT_PARSE_CHANGED'
  | 'YT_RATE_LIMITED'
  | 'YT_NETWORK'
  | 'PLAYBACK_FORBIDDEN'
  | 'PLAYBACK_EXPIRED'
  | 'DB_ERROR'
  | 'INVALID_INPUT'
  | 'INTERNAL';

export interface LuneError {
  code: LuneErrorCode;
  message: string;
  /** Whether a retry of the exact same call could plausibly succeed. */
  retryable: boolean;
  /** Machine-ish extra context (upstream status, parser path). Never a raw stack. */
  detail?: string;
  /** Human-facing next step, shown in the diagnostics panel. */
  hint?: string;
}

const DEFAULT_RETRYABLE: Record<LuneErrorCode, boolean> = {
  YT_UNAVAILABLE: false,
  YT_LOGIN_REQUIRED: false,
  YT_PARSE_CHANGED: false,
  YT_RATE_LIMITED: true,
  YT_NETWORK: true,
  PLAYBACK_FORBIDDEN: false,
  PLAYBACK_EXPIRED: true,
  DB_ERROR: false,
  INVALID_INPUT: false,
  INTERNAL: false,
};

export function makeLuneError(
  code: LuneErrorCode,
  message: string,
  extra?: { retryable?: boolean; detail?: string; hint?: string },
): LuneError {
  const e: LuneError = {
    code,
    message,
    retryable: extra?.retryable ?? DEFAULT_RETRYABLE[code],
  };
  if (extra?.detail !== undefined) e.detail = extra.detail;
  if (extra?.hint !== undefined) e.hint = extra.hint;
  return e;
}

export function isLuneError(value: unknown): value is LuneError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['code'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['retryable'] === 'boolean'
  );
}
