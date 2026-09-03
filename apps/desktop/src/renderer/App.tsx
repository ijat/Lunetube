import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { isLuneError } from '@lunetube/shared';
import { AppFrame } from './shell/AppFrame.js';
import { AppRoutes } from './router.js';
import { useUiStore } from './stores/uiStore.js';

export function App() {
  const hydrate = useUiStore((s) => s.hydrate);

  useEffect(() => {
    let cancelled = false;
    void window.lune.invoke('app:getSettings', {}).then((res) => {
      if (cancelled) return;
      if (res.ok) hydrate(res.value);
      else if (isLuneError(res.error)) console.error('settings load failed:', res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  return (
    <HashRouter>
      <AppFrame>
        <AppRoutes />
      </AppFrame>
    </HashRouter>
  );
}
