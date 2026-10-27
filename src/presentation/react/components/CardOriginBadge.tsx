import type { CardDefinition } from '../../../game';
import { GameIcon } from './GameIcon';
import '../../../styles/tactical-cards.css';

/** A shared visual origin, never a class/ownership/rarity rule. */
export function CardOriginBadge({ card }: { card: CardDefinition }) {
  return card.heroId === undefined ? (
    <span className="card-origin-badge">
      <GameIcon name="neutral" />
      <span className="card-origin-word">Neutral</span>
    </span>
  ) : null;
}
export function NeutralCounter({
  count,
  limit,
  compact = false,
}: {
  count: number;
  limit: number | undefined;
  compact?: boolean;
}) {
  if (limit === undefined) return null;
  return (
    <span
      className={`db-neutral-counter${compact ? ' is-compact' : ''}`}
      data-limit-state={count > limit ? 'over' : count === limit ? 'full' : 'available'}
      role="status"
      aria-label={`${count} de ${limit} cartas neutrales. Máximo ${limit} cartas neutrales por mazo.`}
    >
      <GameIcon name="neutral" />
      <span>
        Neutrales{' '}
        <strong>
          {count}/{limit}
        </strong>
      </span>
      {!compact && (
        <span className="db-neutral-meter" aria-hidden="true">
          {Array.from({ length: limit }, (_, i) => (
            <i key={i} data-filled={i < count} />
          ))}
        </span>
      )}
    </span>
  );
}
