import { useEffect, useState } from 'react';
import type { TurnBanner } from '../../store/battleStore';

// A notification belongs to its store event, not a React mount. Weak references
// retain no old battles; a fresh battle/real turn produces a fresh object.
const presented = new WeakSet<TurnBanner>();
export function TurnAnnouncement({
  banner,
  encounterName,
}: {
  banner: TurnBanner;
  encounterName: string;
}) {
  const [visible] = useState(() => !presented.has(banner));
  useEffect(() => {
    presented.add(banner);
  }, [banner]);
  if (!visible) return null;
  return (
    <div className="turn-banner" data-faction={banner.faction.toLowerCase()} role="status">
      <span className="turn-banner-title">
        {banner.faction === 'PLAYER' ? 'Tu turno' : 'Turno del enemigo'}
      </span>
      <span className="turn-banner-sub">
        {encounterName} · ronda {banner.round}
      </span>
    </div>
  );
}
