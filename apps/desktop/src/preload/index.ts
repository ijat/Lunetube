import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, EVENT_CHANNELS, type HostPlatform, type LuneBridge } from '@lunetube/shared';

const INVOKE_CHANNELS = new Set<string>(Object.values(CHANNELS));
const EVENT_NAMES = new Set<string>(Object.values(EVENT_CHANNELS));

const platform: HostPlatform =
  process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';

const bridge = {
  platform,
  invoke(channel: string, payload: unknown): Promise<unknown> {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!EVENT_NAMES.has(channel)) {
      throw new Error(`Blocked event channel: ${channel}`);
    }
    const wrapped = (_event: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('lune', bridge as unknown as LuneBridge);
