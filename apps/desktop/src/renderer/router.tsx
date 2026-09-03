import { Navigate, Route, Routes } from 'react-router-dom';
import { HomeRoute } from './routes/home/index.js';
import { SearchRoute } from './routes/search/index.js';
import { WatchRoute } from './routes/watch/index.js';
import { ChannelRoute } from './routes/channel/index.js';
import { LibraryRoute } from './routes/library/index.js';
import { SettingsRoute } from './routes/settings/index.js';
import { DevDesignRoute } from './routes/dev-design/index.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/search" element={<SearchRoute />} />
      <Route path="/watch/:videoId" element={<WatchRoute />} />
      <Route path="/channel/:channelId" element={<ChannelRoute />} />
      <Route path="/library" element={<LibraryRoute />} />
      <Route path="/settings" element={<SettingsRoute />} />
      {import.meta.env.DEV && <Route path="/dev/design" element={<DevDesignRoute />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
