/// <reference types="vite/client" />
import type { LuneBridge } from '@lunetube/shared';

declare global {
  interface Window {
    /** Injected by preload. Absent if preload failed to load — always reach it
     * via `bridge()` / `hasBridge()` from `./bridge.ts` (F13), never directly. */
    lune?: LuneBridge;
  }
}

export {};
