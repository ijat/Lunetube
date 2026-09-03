import type { Chapter } from './video.js';

export interface VideoTrack {
  id: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  width: number;
  height: number;
  fps: number;
  /** Already rewritten to the loopback proxy (`http://127.0.0.1:<port>/<token>/media?u=…`). */
  url: string;
}

export interface AudioTrack {
  id: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  sampleRate: number;
  channels: number;
  language: string | null;
  isDefault: boolean;
  url: string;
}

export interface CaptionTrack {
  languageCode: string;
  label: string;
  kind: 'standard' | 'asr';
  url: string;
}

export interface StoryboardSpec {
  level: number;
  url: string;
  rows: number;
  columns: number;
  intervalMs: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  thumbnailCount: number;
}

export interface StreamPrefs {
  maxHeight: number | 'auto';
  preferredAudioLanguage: string | null;
  audioOnly: boolean;
}

export interface StreamManifest {
  kind: 'dash';
  /** Full DASH MPD; every media/segment URL points at the loopback proxy. */
  manifestXml: string;
  video: VideoTrack[];
  audio: AudioTrack[];
  captions: CaptionTrack[];
  storyboards: StoryboardSpec[];
  chapters: Chapter[];
  isLive: boolean;
  durationSec: number;
  /** Epoch ms after which the underlying googlevideo URLs 403 and must be re-resolved. */
  expiresAt: number;
  /** Which InnerTube client produced this manifest (diagnostics). */
  client: string;
}
