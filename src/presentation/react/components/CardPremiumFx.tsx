import { FINAL_CARD_ART } from '../../assets/paintedAssets';
import { useCosmeticCard } from '../../cosmetics/cardCosmetics';
import '../../../styles/free-catalog.css';
import '../../../styles/art-foil.css';
import type { CardDefinition } from '../../../game';
import { premiumIdentity, cardRarityFinish } from '../../cards/premiumTreatment';

/** Art-only layers; no overlays above cost/name/rules/rarity. Flat paintings remain intact. */
export function CardPremiumFx({ def }: { def: CardDefinition }) {
  const visual = useCosmeticCard(def) ?? def;
  const identity = premiumIdentity(visual);
  if (cardRarityFinish(visual) === 'common' || cardRarityFinish(visual) === 'rare') return null;
  return (
    <span className="cp-effects" data-art-foil="prismatic" data-rarity-finish={cardRarityFinish(visual)} aria-hidden="true">
      {def.acquisition?.source === 'RANKED_PREMIUM' && !FINAL_CARD_ART[def.id] && (
        <span className="cp-art-pending">Arte pendiente</span>
      )}
      {identity.layers?.map((layer) => (
        <img
          key={`${layer.depth}:${layer.src}`}
          src={layer.src}
          alt=""
          className={`cp-art-layer cp-depth-${layer.depth}`}
        />
      ))}
      <span className="cp-foil" />
      <span className="cp-sweep" />
      <span className="cp-motes">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Cosmetic identity belongs in card metadata, never inside the illustration. */
export function CardCosmeticMark({ def }: { def: CardDefinition }) {
  const visual = useCosmeticCard(def) ?? def;
  const label = premiumIdentity(visual).treatment === 'showcase'
    ? 'Showcase · Cosmético'
    : cardRarityFinish(visual) === 'arcana-secret' ? 'Arcana Secreta · Cosmético' : null;
  return label ? <span className="cp-cosmetic-mark" title={label} aria-label={label}>✧</span> : null;
}
