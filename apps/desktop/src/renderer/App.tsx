import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { isLuneError } from '@lunetube/shared';
import { AppFrame } from './shell/AppFrame.js';
import { AppRoutes } from './router.js';
import { bridge, hasBridge } from './bridge.js';
import { makeQueryClient } from './lib/queryClient.js';
import { useUiStore } from './stores/uiStore.js';

const queryClient = makeQueryClient();

export function App() {
  const hydrate = useUiStore((s) => s.hydrate);
  const bridgeReady = hasBridge();

  useEffect(() => {
    if (!bridgeReady) return;
    let cancelled = false;
    void bridge()
      .invoke('app:getSettings', {})
      .then((res) => {
        if (cancelled) return;
        if (res.ok) hydrate(res.value);
        else if (isLuneError(res.error)) console.error('settings load failed:', res.error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrate, bridgeReady]);

  if (!bridgeReady) {
    return (
      <div className="stage" data-dir="b">
        <div className="bridge-error" role="alert">
          <h1>LuneTube could not start</h1>
          <p>The privileged preload bridge failed to load. Try restarting the app.</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppFrame>
          <AppRoutes />
        </AppFrame>
      </HashRouter>
    </QueryClientProvider>
  );
}
