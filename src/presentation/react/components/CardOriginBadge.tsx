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
export function NeutralCounter({count,compact=false}:{count:number;compact?:boolean}) {
  return <span className={`db-neutral-counter${compact ? ' is-compact' : ''}`} role="status" aria-label={`${count} cartas neutrales`}>
    <GameIcon name="neutral" /><span>Neutrales: <strong>{count}</strong></span>
  </span>;
}
