import type { CardDefinition } from '../../../game';
import { worldRewardIdentity } from '../../cards/worldRewardPresentation';

export function WorldRewardBadge({
  def,
  compact = false,
}: {
  def: CardDefinition;
  compact?: boolean;
}) {
  const origin = worldRewardIdentity(def);
  return origin ? (
    <span
      className={`world-origin${compact ? ' world-origin--compact' : ''}`}
      data-origin-world={origin.worldId}
      title={`${origin.label} · ${origin.name}`}
    >
      {!compact && <small>{origin.label}</small>}
      <strong>{origin.name}</strong>
    </span>
  ) : null;
}
