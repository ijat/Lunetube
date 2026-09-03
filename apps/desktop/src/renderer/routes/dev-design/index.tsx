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
    </section>
  );
}
