import { shell } from 'electron';
import { makeLuneError, type Settings } from '@lunetube/shared';
import { getSettings, setSettings } from '../settings.js';
import { currentWindowState } from '../windows/mainWindow.js';
import { defineHandler } from './registry.js';

export function registerAppIpc(): void {
  defineHandler('app:getSettings', () => getSettings());

  defineHandler(
    'app:setSettings',
    ({ patch }) => setSettings(patch),
    (payload): { patch: Partial<Settings> } => {
      if (typeof payload !== 'object' || payload === null || !('patch' in payload)) {
        throw makeLuneError('INVALID_INPUT', 'app:setSettings expects a { patch } object');
      }
      const { patch } = payload as { patch: unknown };
      if (typeof patch !== 'object' || patch === null) {
        throw makeLuneError('INVALID_INPUT', 'app:setSettings patch must be an object');
      }
      return { patch: patch as Partial<Settings> };
    },
  );

  defineHandler('app:openExternal', async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw makeLuneError('INVALID_INPUT', `Not a URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
      throw makeLuneError('INVALID_INPUT', `Refusing to open non-https URL: ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
  });

  defineHandler('win:getState', () => currentWindowState());
}
