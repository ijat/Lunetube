/** The eight PRD §5 window / fullscreen modes (mini-player + PiP counted together). */
export type WindowMode =
  | 'normal'
  | 'maximized'
  | 'borderless-fullscreen'
  | 'exclusive-fullscreen'
  | 'player-fullscreen'
  | 'theater'
  | 'mini-player';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  mode: WindowMode;
  displayId: number | null;
  bounds: WindowBounds | null;
  isFullscreen: boolean;
  alwaysOnTop: boolean;
}
