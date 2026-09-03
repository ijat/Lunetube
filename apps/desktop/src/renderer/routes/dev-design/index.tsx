import { useState } from 'react';
import {
  Button,
  Chip,
  IconButton,
  Menu,
  Panel,
  Segmented,
  Skeleton,
  Slider,
  Switch,
  Tooltip,
} from '@lunetube/design';
import { Heart, MoreVertical, Play } from 'lucide-react';
import { PlayerSurface } from '../../player/PlayerSurface.js';

export function DevDesignRoute() {
  const [seg, setSeg] = useState('a');
  const [on, setOn] = useState(true);
  const [slider, setSlider] = useState(40);

  return (
    <section className="route" style={{ display: 'grid', gap: 24 }}>
      <div>
        <p className="route__kicker">Dev</p>
        <h1 className="route__title">Primitive gallery</h1>
      </div>

      <Panel className="glass-panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="ghost">Ghost</Button>
        <Button variant="surface">Surface</Button>
        <Button variant="solid">Solid / Follow</Button>
        <Button variant="surface" disabled>
          Disabled
        </Button>
        <Button variant="surface" size="sm" iconStart={<Play size={14} />}>
          Play
        </Button>
        <IconButton label="More">
          <MoreVertical size={18} />
        </IconButton>
      </Panel>

      <Panel
        className="glass-panel"
        style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Chip>Any time</Chip>
        <Chip selected icon={<Heart size={13} />}>
          Selected
        </Chip>
        <Segmented
          options={[
            { value: 'a', label: 'Relevance' },
            { value: 'b', label: 'View count' },
          ]}
          value={seg}
          onChange={setSeg}
          ariaLabel="Sort"
        />
        <Switch checked={on} onChange={setOn} label="Autoplay" />
        <Tooltip label="Tooltip text">
          <Button variant="surface">Hover me</Button>
        </Tooltip>
        <Menu
          trigger={<MoreVertical size={18} />}
          ariaLabel="Row actions"
          items={[
            { key: 'q', label: 'Add to queue', onSelect: () => undefined },
            { key: 's', label: 'Save to playlist', onSelect: () => undefined },
          ]}
        />
      </Panel>

      <Panel className="glass-panel" style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
        <Slider value={slider} onChange={setSlider} aria-label="Demo slider" />
        <Skeleton height={18} />
        <Skeleton width="60%" height={14} />
      </Panel>

      <PlayerHarness />
    </section>
  );
}

/**
 * P1-5 dev harness. The real mount point is P1-6's watch route; this exists so
 * (a) `PlayerSurface` — and therefore shaka-player — is in the renderer's
 * rollup graph, proving it bundles under electron-vite before P1-6 depends on
 * it, and (b) the plan's manual acceptance ("a real YouTube video plays, seeks,
 * switches quality, shows captions") has a surface to run against.
 *
 * It is deliberately opt-in: nothing loads until "Mount player" is pressed, so
 * visiting this route never touches the network and no Playwright spec can trip
 * over a real stream.
 */
function PlayerHarness() {
  const [videoId, setVideoId] = useState('LXb3EKWsInQ');
  const [mounted, setMounted] = useState(false);

  return (
    <Panel className="glass-panel" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          className="topbar__search"
          style={{ maxWidth: 260 }}
          value={videoId}
          aria-label="Video id"
          onChange={(e) => setVideoId(e.currentTarget.value)}
        />
        <Button variant="surface" onClick={() => setMounted((v) => !v)}>
          {mounted ? 'Unmount player' : 'Mount player'}
        </Button>
      </div>
      {mounted && <PlayerSurface key={videoId} videoId={videoId.trim()} />}
    </Panel>
  );
}
