import type { CardDefinition } from '../../../game';
import { cardVisualType, cardTypePalette, CARD_TYPE_VISUALS } from '../../cards/cardType';
import { cardRarityFinish } from '../../cards/premiumTreatment';
import { GameIcon } from './GameIcon';
import '../../../styles/card-types.css';
/** Decorative art-header accent. Cost, rules and premium frame remain independent. */
export function CardTypeVisual({ card, showIcon = true }: { card: CardDefinition; showIcon?: boolean }) {
  const type = cardVisualType(card), visual = CARD_TYPE_VISUALS[type];
  return <span className="card-type-visual" data-card-type={type} data-type-palette={cardTypePalette(card)} data-rarity-finish={cardRarityFinish(card)} role="img" aria-label={visual.label} title={visual.label}>
    <span className="card-type-wash" aria-hidden="true" />
    {showIcon && <span className="card-type-icon"><GameIcon name={visual.icon} /></span>}
  </span>;
}
