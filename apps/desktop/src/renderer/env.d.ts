/// <reference types="vite/client" />
import type { LuneBridge } from '@lunetube/shared';

declare global {
  interface Window {
    lune: LuneBridge;
  }
}

export {};
